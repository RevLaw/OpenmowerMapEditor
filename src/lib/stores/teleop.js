import { writable, derived, get } from "svelte/store";
import { sendTeleop, stopTeleop } from "../api.js";
import { sendMowerControl } from "./control.js";
import { robotLive, robotPose, setRobotLive } from "./robot.js";
import { stickToTwist } from "../robot/teleop.js";
import { notify } from "./toast.js";

// Driving the mower from the editor. OpenMower only obeys joystick commands
// in its AREA_RECORDING mode, so "drive mode" = put the robot into that mode
// (blade off), then stream stick commands ~10 Hz while the stick is held.
// Releasing the stick, hiding the tab or losing focus stops the robot; the
// server-side helper also stops on its own when commands stop arriving.
const SEND_MS = 100;
const SPEED_KEY = "om-drive-speed";

function initialSpeed() {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v > 0 && v <= 1 ? v : 0.5;
  } catch (_e) {
    return 0.5;
  }
}

/** "off" | "entering" | "on" | "exiting" — what the editor asked for. */
export const driveMode = writable("off");
/** 0..1 fraction of the max speed. */
export const driveSpeed = writable(initialSpeed());
/** Current command being sent: { lx, az, turbo }. */
export const driveCommand = writable({ lx: 0, az: 0, turbo: false });

driveSpeed.subscribe((v) => {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SPEED_KEY, String(v));
  } catch (_e) {
    /* ignore */
  }
});

/** The robot's own state name from live telemetry (e.g. "AREA_RECORDING"), or "". */
export const robotStateName = derived(robotPose, ($p) => String($p?.ros?.telemetry?.stateName || ""));
export const robotInRecordingMode = derived(robotStateName, ($s) => /AREA_RECORDING/i.test($s));

let stick = { x: 0, y: 0, turbo: false };
let timer = null;
let inFlight = false;
let lastError = 0;

// Other drive sources (go-to) register here; they're told to stop when the
// joystick takes over or the page loses focus.
const interruptHooks = new Set();

/** Register `fn(reason)`, reason "joystick" | "focus". Returns an unregister function. */
export function onDriveInterrupt(fn) {
  interruptHooks.add(fn);
  return () => interruptHooks.delete(fn);
}

function interrupt(reason) {
  interruptHooks.forEach((fn) => fn(reason));
}

/** True while the stick is held and its send loop is running. */
export function stickActive() {
  return timer != null;
}

async function sendNow() {
  if (inFlight) return;
  const cmd = stickToTwist(stick.x, stick.y, get(driveSpeed), { turbo: stick.turbo });
  driveCommand.set({ ...cmd, turbo: stick.turbo });
  inFlight = true;
  try {
    const res = await sendTeleop(cmd.lx, cmd.az);
    if (res && res.ok === false && Date.now() - lastError > 4000) {
      lastError = Date.now();
      notify(`Drive: ${res.error || "command rejected"}`, "warn");
    }
  } catch (_e) {
    if (Date.now() - lastError > 4000) {
      lastError = Date.now();
      notify("Drive: server unreachable — the robot stops on its own.", "warn");
    }
  } finally {
    inFlight = false;
  }
}

/**
 * Update the stick (x right, y up, -1..1; `turbo` while the thumb is in the
 * sprint bubble). Starts / stops the send loop.
 */
export function setStick(x, y, turbo = false) {
  if (get(driveMode) !== "on") return;
  const turboChanged = turbo !== stick.turbo;
  stick = { x, y, turbo };
  const moving = turbo || x !== 0 || y !== 0;
  // Any stick input takes over from go-to (the hook is a no-op when it isn't driving).
  if (moving) interrupt("joystick");
  if (moving && !timer) {
    sendNow();
    timer = setInterval(sendNow, SEND_MS);
  } else if (moving && turboChanged) {
    // Sprint starts / ends right away, not on the next tick.
    sendNow();
  } else if (!moving && timer) {
    releaseStick();
  }
}

/** Stick released: stop the loop and send an explicit zero. */
export function releaseStick() {
  stick = { x: 0, y: 0, turbo: false };
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  driveCommand.set({ lx: 0, az: 0, turbo: false });
  sendTeleop(0, 0).catch(() => {});
}

/** Put the robot into OpenMower's area-recording mode so it accepts the joystick. */
export async function enterDriveMode() {
  if (!get(robotLive)) setRobotLive(true);
  driveMode.set("entering");
  const ok = await sendMowerControl("record_mode");
  driveMode.set(ok ? "on" : "off");
  if (ok) notify("Drive mode on — the robot follows the joystick (blade off).", "info");
  return ok;
}

/** Stop driving and leave area-recording mode (nothing is saved on the robot). */
export async function exitDriveMode() {
  releaseStick();
  driveMode.set("exiting");
  stopTeleop().catch(() => {});
  await sendMowerControl("record_exit");
  driveMode.set("off");
}

/** Safety: stop immediately when the page loses focus or is hidden. */
export function initTeleopSafety() {
  if (typeof window === "undefined") return () => {};
  const halt = () => {
    interrupt("focus");
    if (timer || stick.x || stick.y) releaseStick();
  };
  const onVis = () => document.hidden && halt();
  window.addEventListener("blur", halt);
  window.addEventListener("pagehide", halt);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.removeEventListener("blur", halt);
    window.removeEventListener("pagehide", halt);
    document.removeEventListener("visibilitychange", onVis);
    halt();
  };
}
