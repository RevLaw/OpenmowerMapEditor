import { writable } from "svelte/store";
import { sendControl } from "../api.js";
import { notify } from "./toast.js";

const LABELS = {
  start: "Start mowing",
  stop: "Emergency stop",
  home: "Return home",
  reset_emergency: "Reset emergency",
};

/** True while a control command is in flight (disables the buttons, except Stop). */
export const controlSending = writable(false);
let inFlight = 0; // Stop can run while a long Home is still going

/** Send a whitelisted mower command and toast the result. Returns success. */
export async function sendMowerControl(command) {
  inFlight++;
  controlSending.set(true);
  try {
    const res = await sendControl(command);
    if (res && res.ok) {
      const text = res.note || `${LABELS[command] || command} sent.`;
      notify(`Mower: ${text}`, command === "stop" ? "warn" : "info");
      return true;
    }
    notify(`Mower: ${(res && res.error) || "command failed"}`, "warn");
    return false;
  } catch (_e) {
    notify("Mower: control request failed (server or ROS unreachable).", "warn");
    return false;
  } finally {
    inFlight--;
    controlSending.set(inFlight > 0);
  }
}
