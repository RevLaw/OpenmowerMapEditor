import { derived, get, writable } from "svelte/store";
import { appendTrailPoint } from "../robot/trail.js";
import {
  deleteRobotTrailHistory,
  fetchRobotTrailArchiveList,
  fetchRobotTrailArchiveSession,
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

/** Local "YYYY-MM-DD" calendar-day key for a timestamp — the unit the date picker navigates by. */
function dateKeyOf(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayDateKey() {
  return dateKeyOf(Date.now());
}

function byTime(a, b) {
  return (a.t ?? 0) - (b.t ?? 0);
}

/** Past mow sessions available to browse: [{id, startedAt, endedAt, pointCount}]. */
export const robotTrailArchiveList = writable([]);
/** The calendar day currently shown in the date picker; defaults to today. */
export const robotTrailSelectedDate = writable(todayDateKey());
/** Merged, time-sorted points from every archived session on robotTrailSelectedDate. */
export const robotTrailArchivePoints = writable([]);

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
  // Always come back to viewing today, not a stale past pick.
  if (!enabled) {
    robotTrailSelectedDate.set(todayDateKey());
    robotTrailArchivePoints.set([]);
  }
});

/**
 * What the overlay should actually draw. On today, that's the live synced
 * history plus any already-archived sessions from earlier today (e.g. a
 * finished mow followed by a new one still running) — merged and
 * time-sorted so mapController's gap-based segmenting still makes sense. On
 * any other day, it's just that day's archived sessions.
 */
export const robotTrailDisplayPoints = derived(
  [robotTrailSelectedDate, robotTrailArchivePoints, robotTrailHistoryPoints],
  ([$selectedDate, $archivePoints, $historyPoints]) => {
    if ($selectedDate !== todayDateKey()) return $archivePoints;
    if (!$archivePoints.length) return $historyPoints;
    return [...$archivePoints, ...$historyPoints].sort(byTime);
  }
);

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
  if (enabled) {
    syncRobotTrailHistoryQuietly(true);
    loadRobotTrailArchiveListQuietly();
  }
}

export async function clearRobotTrailHistory() {
  const requestEpoch = captureIntentEpoch;
  const data = await deleteRobotTrailHistory();
  applyHistoryServerPayload({ ...data, points: [] }, requestEpoch);
  // The just-cleared session is now archived server-side; reflect that in the picker.
  loadRobotTrailArchiveListQuietly();
}

/** Refresh the list of past mow sessions, then re-resolve whichever day is currently selected. */
export async function loadRobotTrailArchiveList() {
  const data = await fetchRobotTrailArchiveList();
  robotTrailArchiveList.set(Array.isArray(data?.sessions) ? data.sessions : []);
  await selectRobotTrailDate(get(robotTrailSelectedDate));
  return data;
}

function loadRobotTrailArchiveListQuietly() {
  loadRobotTrailArchiveList().catch(() => {});
}

/** Switch the date picker to `dateKey` ("YYYY-MM-DD") and load that day's archived sessions, if any. */
export async function selectRobotTrailDate(dateKey) {
  robotTrailSelectedDate.set(dateKey);
  const sessionsThatDay = get(robotTrailArchiveList).filter((s) => dateKeyOf(s.startedAt) === dateKey);
  if (!sessionsThatDay.length) {
    robotTrailArchivePoints.set([]);
    return;
  }
  try {
    const sessions = await Promise.all(sessionsThatDay.map((s) => fetchRobotTrailArchiveSession(s.id)));
    const points = sessions.flatMap((s) => (Array.isArray(s?.points) ? s.points : []));
    points.sort(byTime);
    robotTrailArchivePoints.set(points);
  } catch (_error) {
    notify("Could not load the movement trail for that day.", "warn");
  }
}

/** Move the date picker by `deltaDays` (e.g. -1/+1 for the prev/next arrows); never past today. */
export function shiftRobotTrailDate(deltaDays) {
  const [y, m, d] = get(robotTrailSelectedDate).split("-").map(Number);
  const nextKey = dateKeyOf(new Date(y, m - 1, d + deltaDays).getTime());
  if (nextKey > todayDateKey()) return;
  selectRobotTrailDate(nextKey).catch(() => {});
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
