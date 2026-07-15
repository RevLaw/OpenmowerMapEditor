import { writable, derived, get } from "svelte/store";
import { fetchRobotPose } from "../api.js";
import { buildRobotHudLines } from "../robot/telemetry.js";
import { notify, setStatus } from "./toast.js";
import { ingestWifiPose } from "./wifi.js";

const STORAGE_KEY = "openmower-map-editor-robot-live";
const POLL_MS = 1000;

function initialLive() {
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(STORAGE_KEY) === "1";
  }
  return false;
}

export const robotLive = writable(initialLive());
/** Last successful pose payload (or null). */
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
  if (lines.length) return lines.join("\n");
  if ($pose.ros?.summary) return $pose.ros.summary;
  return "Map position only — ROS status not received yet.";
});

let timer = null;
let inFlight = false;
let failCount = 0;
const gate = { params: false, map: false };

function ready() {
  return gate.params && gate.map;
}

async function pollOnce() {
  if (!get(robotLive) || (typeof document !== "undefined" && document.hidden)) return;
  if (inFlight) return;
  inFlight = true;
  try {
    const data = await fetchRobotPose();
    if (!data.ok) {
      if (data.liveRobotFatal) {
        setRobotLive(false);
        notify(`Live robot: ${data.error || "unavailable"}`, "warn");
        return;
      }
      failCount += 1;
      if (failCount === 1 || failCount % 6 === 0) {
        setStatus(`Live robot: ${data.error || "unavailable"}`);
      }
      return;
    }
    failCount = 0;
    robotPose.set(data);
    ingestWifiPose(data);
  } catch (_e) {
    failCount += 1;
    if (failCount === 1 || failCount % 6 === 0) {
      setStatus("Live robot: request failed (server or Docker exec).");
    }
  } finally {
    inFlight = false;
  }
}

function startPolling() {
  stopPolling();
  if (!get(robotLive) || !ready()) return;
  if (typeof document !== "undefined" && document.hidden) return;
  pollOnce();
  timer = setInterval(pollOnce, POLL_MS);
}

function stopPolling() {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

export function setRobotLive(on) {
  robotLive.set(on);
  failCount = 0;
  if (on) {
    if (ready()) {
      startPolling();
      notify("Live robot on (ROS TF via Docker).", "info");
    } else {
      setStatus("Live robot will start after map and projection load.");
    }
  } else {
    stopPolling();
    robotPose.set(null);
    setStatus("Live robot overlay off.");
  }
}

export function toggleRobotLive() {
  setRobotLive(!get(robotLive));
}

export function markParamsReady() {
  gate.params = true;
  if (get(robotLive) && ready()) startPolling();
}

export function markMapReady() {
  gate.map = true;
  if (get(robotLive) && ready()) startPolling();
}

/** Force an immediate refresh (e.g. after projection change). */
export function refreshRobotIfLive() {
  if (get(robotLive) && ready()) pollOnce();
}

/** Wire visibility / page lifecycle handling. Call once on mount. */
export function initRobotLifecycle() {
  if (typeof document === "undefined") return () => {};
  const onVis = () => {
    if (document.hidden) stopPolling();
    else if (get(robotLive) && ready()) startPolling();
  };
  const onHide = () => stopPolling();
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", onHide);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", onHide);
    stopPolling();
  };
}
