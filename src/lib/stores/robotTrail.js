import { get, writable } from "svelte/store";
import { appendTrailPoint } from "../robot/trail.js";
import {
  deleteRobotTrailHistory,
  fetchRobotTrailHistory,
  setRobotTrailCapture,
} from "../api.js";
import { notify } from "./toast.js";

// "Enabled" here means capture is on — a shared, mower-side setting (every
// browser, persists across restarts), not a per-browser display preference.
// The localStorage value is just an optimistic first guess before the first
// sync corrects it to server truth.
const ENABLED_KEY = "openmower-map-editor-robot-trail-enabled";
const HISTORY_ENABLED_KEY = "openmower-map-editor-robot-trail-history-enabled";
const SYNC_MS = 15000;

/**
 * Classify a raw mower state name into the trail phase used to color it:
 * "docking" covers both DOCKING and UNDOCKING (any name containing DOCK),
 * "mowing" covers active mowing. Mirrors the same classification server.js
 * applies when appending points to the saved history.
 */
function classifyTrailPhase(stateName) {
  const raw = String(stateName || "");
  if (!raw) return null;
  if (/DOCK/i.test(raw)) return "docking";
  if (/MOW/i.test(raw)) return "mowing";
  return null;
}

function loadEnabled() {
  return typeof localStorage !== "undefined" && localStorage.getItem(ENABLED_KEY) === "1";
}

function loadHistoryEnabled() {
  return typeof localStorage !== "undefined" && localStorage.getItem(HISTORY_ENABLED_KEY) === "1";
}

/** Is the mower's movement-trail capture currently on? Shared/server state. */
export const robotTrailEnabled = writable(loadEnabled());
/** Bounded breadcrumb of this session's recent positions; see lib/robot/trail.js. */
export const robotTrail = writable([]);
/** Overlay the persisted, mower-side trail on the map — a local display toggle only. */
export const robotTrailHistoryEnabled = writable(loadHistoryEnabled());
export const robotTrailHistoryPoints = writable([]);
export const robotTrailHistoryStorage = writable({
  central: true,
  minDistanceM: 0.15,
  maxPoints: 20000,
  flushIntervalMs: 30000,
  fileBytes: 0,
  collector: { enabled: true, capturing: false },
});

robotTrailEnabled.subscribe((enabled) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  }
  if (!enabled) {
    robotTrail.set([]);
    // The overlay toggle is only shown nested under this one; turning this
    // off would otherwise strand the overlay on with no visible control to
    // turn it back off.
    robotTrailHistoryEnabled.set(false);
  }
});

robotTrailHistoryEnabled.subscribe((enabled) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(HISTORY_ENABLED_KEY, enabled ? "1" : "0");
  }
});

let historyKnownRevision = null;
let historySyncPromise = null;
// Bumped on every setRobotTrailEnabled call. A poll/clear response whose
// snapshot doesn't match the current epoch was in flight during a toggle and
// may be stale, so it's applied everywhere except the capturing bit — that
// one field is left for the toggle's own (or a later, current) response to
// set, so a slow poll can't snap the switch back right after the user flips it.
let captureIntentEpoch = 0;

function applyHistoryServerPayload(data, requestEpoch = captureIntentEpoch) {
  if (Number.isFinite(data?.revision)) historyKnownRevision = data.revision;
  if (data?.storage) {
    robotTrailHistoryStorage.set(data.storage);
    if (requestEpoch === captureIntentEpoch) {
      robotTrailEnabled.set(Boolean(data.storage?.collector?.capturing));
    }
  }
  if (!data?.notModified && Array.isArray(data?.points)) {
    robotTrailHistoryPoints.set(data.points);
  }
}

/** Fetch the mower's trail status + saved points; revision-aware like the WiFi survey sync. */
export async function syncRobotTrailHistory(force = false) {
  if (historySyncPromise) return historySyncPromise;
  const requestEpoch = captureIntentEpoch;
  historySyncPromise = (async () => {
    try {
      const data = await fetchRobotTrailHistory(force ? null : historyKnownRevision);
      applyHistoryServerPayload(data, requestEpoch);
      return data;
    } finally {
      historySyncPromise = null;
    }
  })();
  return historySyncPromise;
}

function syncRobotTrailHistoryQuietly(force = false) {
  syncRobotTrailHistory(force).catch(() => {});
}

/** Starts/stops the mower's trail capture. Shared and persisted — affects every browser. */
export async function setRobotTrailEnabled(enabled) {
  const want = Boolean(enabled);
  captureIntentEpoch += 1;
  const requestEpoch = captureIntentEpoch;
  robotTrailEnabled.set(want); // optimistic; corrected by the server's response either way
  try {
    const data = await setRobotTrailCapture(want);
    applyHistoryServerPayload(data, requestEpoch);
  } catch (_error) {
    if (requestEpoch === captureIntentEpoch) robotTrailEnabled.set(!want);
    notify(`Movement trail: could not ${want ? "start" : "stop"} capture.`, "warn");
  }
}

/** Feed a live pose into this session's breadcrumb buffer; no-op unless capture is on. */
export function ingestRobotTrailPose(pose) {
  if (!get(robotTrailEnabled) || !pose?.ok) return;
  const phase = classifyTrailPhase(pose?.ros?.telemetry?.stateName);
  robotTrail.update((trail) => appendTrailPoint(trail, { x: pose.x, y: pose.y, phase }, Date.now()));
}

export function clearRobotTrail() {
  robotTrail.set([]);
}

export function setRobotTrailHistoryEnabled(enabled) {
  robotTrailHistoryEnabled.set(Boolean(enabled));
  if (enabled) syncRobotTrailHistoryQuietly(true);
}

export async function clearRobotTrailHistory() {
  const requestEpoch = captureIntentEpoch;
  const data = await deleteRobotTrailHistory();
  applyHistoryServerPayload({ ...data, points: [] }, requestEpoch);
}

/**
 * Wire periodic sync while the tab is visible. Runs regardless of either
 * toggle — capture status is shared/operational, not just a display
 * preference, so the main toggle needs to stay accurate even when the
 * history overlay is off.
 */
export function initRobotTrailHistoryLifecycle() {
  if (typeof document === "undefined") return () => {};
  let timer = null;
  const syncIfVisible = () => {
    if (!document.hidden) syncRobotTrailHistoryQuietly();
  };

  syncIfVisible();
  timer = setInterval(syncIfVisible, SYNC_MS);
  document.addEventListener("visibilitychange", syncIfVisible);
  return () => {
    if (timer != null) clearInterval(timer);
    document.removeEventListener("visibilitychange", syncIfVisible);
  };
}
