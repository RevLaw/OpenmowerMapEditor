import { get, writable } from "svelte/store";
import { appendTrailPoint } from "../robot/trail.js";

const ENABLED_KEY = "openmower-map-editor-robot-trail-enabled";

function loadEnabled() {
  return typeof localStorage !== "undefined" && localStorage.getItem(ENABLED_KEY) === "1";
}

export const robotTrailEnabled = writable(loadEnabled());
/** Bounded breadcrumb of recent map-frame positions; see lib/robot/trail.js. */
export const robotTrail = writable([]);

robotTrailEnabled.subscribe((enabled) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  }
  if (!enabled) robotTrail.set([]);
});

export function setRobotTrailEnabled(enabled) {
  robotTrailEnabled.set(Boolean(enabled));
}

/** Feed a live pose into the trail buffer; no-op unless the trail is on. */
export function ingestRobotTrailPose(pose) {
  if (!get(robotTrailEnabled) || !pose?.ok) return;
  robotTrail.update((trail) => appendTrailPoint(trail, pose, Date.now()));
}

export function clearRobotTrail() {
  robotTrail.set([]);
}
