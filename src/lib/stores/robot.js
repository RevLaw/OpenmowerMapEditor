import { writable, derived, get } from "svelte/store";
import { fetchRobotPose } from "../api.js";
import { buildRobotHudLines } from "../robot/telemetry.js";
import { notify, setStatus } from "./toast.js";

const STORAGE_KEY = "openmower-map-editor-robot-live";
const STREAM_URL = "/api/robot_pose/stream";
const POLL_MS = 1000; // fallback only, when EventSource is unavailable/rejected

function initialLive() {
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(STORAGE_KEY) === "1";
  }
  return false;
}

export const robotLive = writable(initialLive());
/** Last received pose payload (or null). The map layer interpolates between these. */
export const robotPose = writable(null);

robotLive.subscribe((v) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  }
});

/** Sidebar readout text derived from the latest pose. */
export const robotReadout = derived([robotLive, robotPose], ([$live, $pose]) => {
  if (!$live || !$pose || !$pose.ok) return null;
  const lines = buildRobotHudLines($pose.ros?.telemetry || null);
  if ($pose.gpsRtk) lines.push($pose.gpsRtk);
  if (lines.length) return lines.join("\n");
  if ($pose.ros?.summary) return $pose.ros.summary;
  return "Map position only — ROS status not received yet.";
});

let source = null; // EventSource
let pollTimer = null; // fallback interval
let pollInFlight = false;
let failCount = 0;
const gate = { params: false, map: false };

function ready() {
  return gate.params && gate.map;
}

function handlePayload(data) {
  if (!data || !data.ok) {
    if (data && data.liveRobotFatal) {
      setRobotLive(false);
      notify(`Live robot: ${data.error || "unavailable"}`, "warn");
      return;
    }
    failCount += 1;
    if (failCount === 1 || failCount % 6 === 0) {
      setStatus(`Live robot: ${(data && data.error) || "unavailable"}`);
    }
    return;
  }
  failCount = 0;
  robotPose.set(data);
}

// ---- SSE (primary) --------------------------------------------------------

function connectStream() {
  if (source || typeof EventSource === "undefined") return false;
  try {
    source = new EventSource(STREAM_URL);
  } catch (_e) {
    source = null;
    return false;
  }
  source.onmessage = (evt) => {
    if (!evt.data) return;
    try {
      handlePayload(JSON.parse(evt.data));
    } catch (_e) {
      /* ignore malformed frame */
    }
  };
  source.onerror = () => {
    // CLOSED means the server rejected the stream (e.g. older backend) — fall
    // back to polling. CONNECTING means a transient drop; EventSource retries.
    if (source && source.readyState === EventSource.CLOSED) {
      teardownStream();
      startPollingFallback();
    }
  };
  return true;
}

function teardownStream() {
  if (source) {
    source.close();
    source = null;
  }
}

// ---- polling fallback -----------------------------------------------------

async function pollOnce() {
  if (!get(robotLive) || (typeof document !== "undefined" && document.hidden)) return;
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    handlePayload(await fetchRobotPose());
  } catch (_e) {
    failCount += 1;
    if (failCount === 1 || failCount % 6 === 0) {
      setStatus("Live robot: request failed (server or Docker exec).");
    }
  } finally {
    pollInFlight = false;
  }
}

function startPollingFallback() {
  stopPollingFallback();
  if (!get(robotLive) || !ready()) return;
  if (typeof document !== "undefined" && document.hidden) return;
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_MS);
}

function stopPollingFallback() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---- lifecycle ------------------------------------------------------------

function start() {
  stop();
  if (!get(robotLive) || !ready()) return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (!connectStream()) startPollingFallback();
}

function stop() {
  teardownStream();
  stopPollingFallback();
}

export function setRobotLive(on) {
  robotLive.set(on);
  failCount = 0;
  if (on) {
    if (ready()) {
      start();
      notify("Live robot on — streaming pose from open_mower_ros.", "info");
    } else {
      setStatus("Live robot will start after map and projection load.");
    }
  } else {
    stop();
    robotPose.set(null);
    setStatus("Live robot overlay off.");
  }
}

export function toggleRobotLive() {
  setRobotLive(!get(robotLive));
}

export function markParamsReady() {
  gate.params = true;
  if (get(robotLive) && ready()) start();
}

export function markMapReady() {
  gate.map = true;
  if (get(robotLive) && ready()) start();
}

/** Re-emit the current pose so the map layer reprojects (e.g. after a projection change). */
export function refreshRobotIfLive() {
  if (!get(robotLive) || !ready()) return;
  const p = get(robotPose);
  if (p) robotPose.set({ ...p });
  else if (!source) pollOnce();
}

/** Wire visibility / page lifecycle handling. Call once on mount. */
export function initRobotLifecycle() {
  if (typeof document === "undefined") return () => {};
  const onVis = () => {
    if (document.hidden) stop();
    else if (get(robotLive) && ready()) start();
  };
  const onHide = () => stop();
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", onHide);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", onHide);
    stop();
  };
}
