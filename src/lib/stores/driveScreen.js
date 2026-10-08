import { get } from "svelte/store";
import { driveView, editMode, followRobot } from "./ui.js";
import { driveMode, enterDriveMode, exitDriveMode } from "./teleop.js";
import { cancelGoto } from "./goto.js";

// Opening / closing the fullscreen drive screen: drive mode on, editing chrome
// off, map following the robot, and the browser's Fullscreen API where it
// exists (not on iPhone — the layout fills the viewport there instead).
let editModeBefore = null;

function enterFullscreen() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  } catch (_e) {
    /* not supported */
  }
}

function leaveFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch (_e) {
    /* not supported */
  }
}

/** Show the drive screen and enter drive mode. Resolves false if drive mode couldn't start. */
export async function openDriveScreen() {
  // First, while the click still counts as a user gesture for the Fullscreen API.
  enterFullscreen();
  if (!get(driveView)) {
    editModeBefore = get(editMode);
    editMode.set(false);
    driveView.set(true);
  }
  followRobot.set(true);
  if (get(driveMode) === "off") {
    const ok = await enterDriveMode();
    if (!ok) {
      await closeDriveScreen({ leaveDriveMode: false });
      return false;
    }
  }
  return true;
}

/** Hide the drive screen; by default also leave drive mode (stops go-to and the stick). */
export async function closeDriveScreen({ leaveDriveMode = true } = {}) {
  cancelGoto();
  driveView.set(false);
  if (editModeBefore != null) editMode.set(editModeBefore);
  editModeBefore = null;
  leaveFullscreen();
  if (leaveDriveMode && get(driveMode) === "on") await exitDriveMode();
}
