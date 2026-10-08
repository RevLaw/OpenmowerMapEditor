import { get } from "svelte/store";
import { driveView, editMode, followRobot } from "./ui.js";
import { driveMode, enterDriveMode, exitDriveMode } from "./teleop.js";
import { cancelGoto } from "./goto.js";

// Opening / closing the drive screen: drive mode on, editing chrome off and
// the map following the robot. It fills the app's window; the browser itself
// is never forced into fullscreen.
let editModeBefore = null;

/** Show the drive screen and enter drive mode. Resolves false if drive mode couldn't start. */
export async function openDriveScreen() {
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
  if (leaveDriveMode && get(driveMode) === "on") await exitDriveMode();
}
