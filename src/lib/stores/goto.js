import { writable, get } from "svelte/store";
import { sendTeleop } from "../api.js";
import { editor } from "./editor.js";
import { robotPose } from "./robot.js";
import { driveMode, robotInRecordingMode, onDriveInterrupt, stickActive } from "./teleop.js";
import { notify } from "./toast.js";
import { getAreaType } from "../format/mapFormat.js";
import { getEditablePoints } from "../format/outline.js";
import { planRoute } from "../geo/route.js";
import { followStep, offRouteDistance, remainingDistance } from "../robot/follow.js";

// Go to position: tap a target in the drive screen, the editor plans a route
// around obstacle zones (geo/route.js) and steers the robot along it by
// sending joystick commands through the normal teleop channel — OpenMower
// ignores outside navigation goals while idle or recording, so this only works
// in drive mode. Any doubt (stale or inaccurate pose, off the route, joystick
// touched, focus lost, server trouble) stops the robot with an explicit zero.
const TICK_MS = 100;
const POSE_STALE_MS = 1000;
const MAX_ACCURACY_M = 0.2;
const OFF_ROUTE_M = 0.25; // below the route's 0.35 m clearance, so a drift stops before it reaches an edge
const NO_RESPONSE_MS = 1000;
const DISMISS_MS = { arrived: 4000, stopped: 8000 };
export const GOTO_SPEED = 0.3; // m/s

const ROUTE_REASONS = {
  "no-drivable-area": "The map has no mow or nav zones.",
  "start-outside": "The robot is outside the mow/nav zones (or inside an obstacle).",
  "target-outside": "That spot is outside the mow/nav zones.",
  "target-blocked": "That spot is inside an obstacle or too close to an edge.",
  "no-route": "No route there — blocked by obstacles.",
};
const INTERRUPTS = { joystick: "joystick used.", focus: "the app lost focus." };

const IDLE = { phase: "idle", target: null, start: null, waypoints: [], index: 0, length: 0, remaining: 0, reason: "" };

/** phase: idle | picking | planned | driving | arrived | stopped */
export const gotoState = writable(IDLE);

let lastPose = null;
let lastPoseAt = 0;
let timer = null;
let inFlight = null; // pending sendTeleop promise
let inFlightSince = 0;
let dismissTimer = null;

robotPose.subscribe((p) => {
  if (p?.ok) {
    lastPose = p;
    lastPoseAt = Date.now();
  }
});

/** Why go-to can't run right now, or "" when it can. */
export function gotoBlocker(now = Date.now()) {
  if (get(driveMode) !== "on") return "Start drive mode first.";
  if (!lastPose || now - lastPoseAt > POSE_STALE_MS) return "Waiting for live position.";
  if (!get(robotInRecordingMode)) return "Waiting for the robot to accept commands.";
  if (lastPose.source !== "stream") return "Needs the live position stream.";
  const acc = lastPose.positionAccuracy;
  if (acc == null || !(acc <= MAX_ACCURACY_M)) return "Position not accurate enough (RTK).";
  return "";
}

function currentZones() {
  const areas = get(editor).mapData?.areas || [];
  return areas.map((a) => ({ type: getAreaType(a), points: getEditablePoints(a.outline || []) }));
}

function setState(next) {
  clearTimeout(dismissTimer);
  dismissTimer = null;
  gotoState.set(next);
  const ms = DISMISS_MS[next.phase];
  if (ms) {
    dismissTimer = setTimeout(() => {
      if (get(gotoState) === next) gotoState.set(IDLE);
    }, ms);
  }
}

function plan(target) {
  const start = { x: lastPose.x, y: lastPose.y };
  const res = planRoute(currentZones(), start, target);
  return res.ok ? { start, ...res } : { start, error: ROUTE_REASONS[res.reason] || "No route." };
}

function halt() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const zero = () => sendTeleop(0, 0).catch(() => {});
  zero();
  // A command still in flight could land after the zero — send another after it,
  // and stop waiting for it so the next go-to isn't blocked by a hung request.
  if (inFlight) inFlight.finally(zero);
  inFlight = null;
}

/** Next map tap picks the target. */
export function armGoto() {
  setState({ ...IDLE, phase: "picking" });
}

export function cancelGoto() {
  if (get(gotoState).phase === "driving") halt();
  setState(IDLE);
}

/** Plan a route to `target` ({x, y} in map meters) and wait for Go. */
export function pickTarget(target) {
  const phase = get(gotoState).phase;
  if (phase !== "picking" && phase !== "planned") return;
  const blocker = gotoBlocker();
  if (blocker) {
    setState({ ...IDLE, phase: "picking", reason: blocker });
    return;
  }
  const r = plan(target);
  if (r.error) {
    setState({ ...IDLE, phase: "picking", reason: r.error });
    return;
  }
  setState({ ...IDLE, phase: "planned", target, start: r.start, waypoints: r.waypoints, length: r.length, remaining: r.length });
}

export function startGoto() {
  const s = get(gotoState);
  if (s.phase !== "planned") return;
  const blocker = gotoBlocker();
  if (blocker) {
    setState({ ...s, reason: blocker });
    return;
  }
  // Two command sources must never drive at once.
  if (stickActive()) {
    setState({ ...s, reason: "Let go of the joystick first." });
    return;
  }
  // Re-plan from where the robot is now; it may have moved since the tap.
  const r = plan(s.target);
  if (r.error) {
    setState({ ...IDLE, phase: "picking", reason: r.error });
    return;
  }
  setState({ ...s, phase: "driving", start: r.start, waypoints: r.waypoints, length: r.length, remaining: r.length, index: 0, reason: "" });
  timer = setInterval(tick, TICK_MS);
  tick();
}

/** Stop a running go-to (explicit zero). Returns true if it was driving. */
export function stopGoto(reason = "stopped.") {
  const s = get(gotoState);
  if (s.phase !== "driving") return false;
  halt();
  setState({ ...s, phase: "stopped", reason });
  notify(`Go to stopped: ${reason}`, "warn");
  return true;
}

function tick() {
  const s = get(gotoState);
  if (s.phase !== "driving") return;
  const now = Date.now();
  const blocker = gotoBlocker(now);
  if (blocker) {
    stopGoto(blocker);
    return;
  }
  if (stickActive()) {
    stopGoto(INTERRUPTS.joystick);
    return;
  }
  if (inFlight && now - inFlightSince > NO_RESPONSE_MS) {
    stopGoto("the server stopped responding.");
    return;
  }
  if (offRouteDistance(lastPose, s.waypoints, s.index, s.start) > OFF_ROUTE_M) {
    stopGoto("the robot left the route.");
    return;
  }
  const step = followStep(lastPose, s.waypoints, s.index, { maxSpeed: GOTO_SPEED, start: s.start });
  if (step.done) {
    halt();
    setState({ ...s, phase: "arrived", index: step.index, remaining: 0 });
    notify("Go to: arrived.", "success");
    return;
  }
  gotoState.set({ ...s, index: step.index, remaining: remainingDistance(lastPose, s.waypoints, step.index) });
  send(step.lx, step.az);
}

async function send(lx, az) {
  if (inFlight) return;
  const pending = sendTeleop(lx, az);
  inFlight = pending;
  inFlightSince = Date.now();
  try {
    const res = await pending;
    if (res && res.ok === false) stopGoto(`server: ${String(res.error || "command rejected").trim()}.`);
  } catch (_e) {
    stopGoto("server unreachable.");
  } finally {
    if (inFlight === pending) inFlight = null;
  }
}

driveMode.subscribe((mode) => {
  if (mode === "on") return;
  if (stopGoto("drive mode ended.")) return;
  const phase = get(gotoState).phase;
  if (phase === "picking" || phase === "planned") setState(IDLE);
});

onDriveInterrupt((why) => stopGoto(INTERRUPTS[why] || "stopped."));
