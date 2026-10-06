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
/** Current command being sent: { lx, az }. */
export const driveCommand = writable({ lx: 0, az: 0 });

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

let stick = { x: 0, y: 0 };
let timer = null;
let inFlight = false;
let lastError = 0;

async function sendNow() {
  if (inFlight) return;
  const cmd = stickToTwist(stick.x, stick.y, get(driveSpeed));
  driveCommand.set(cmd);
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

/** Update the stick (x right, y up, -1..1). Starts / stops the send loop. */
export function setStick(x, y) {
  if (get(driveMode) !== "on") return;
  stick = { x, y };
  const moving = x !== 0 || y !== 0;
  if (moving && !timer) {
    sendNow();
    timer = setInterval(sendNow, SEND_MS);
  } else if (!moving) {
    releaseStick();
  }
}

/** Stick released: stop the loop and send an explicit zero. */
export function releaseStick() {
  stick = { x: 0, y: 0 };
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  driveCommand.set({ lx: 0, az: 0 });
  sendTeleop(0, 0).catch(() => {});
}

/** Put the robot into OpenMower's area-recording mode so it accepts the joystick. */
export async function enterDriveMode() {
  if (!get(robotLive)) setRobotLive(true);
  driveMode.set("entering");
  const ok = await sendMowerControl("record_mode");
  driveMode.set(ok ? "on" : "off");
  if (ok) notify("Drive mode on — the robot follows the joystick (blade off).", "info");
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
