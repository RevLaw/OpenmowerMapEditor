import { writable } from "svelte/store";

// The mower's xbot_monitoring sensors (battery / charge voltage, temperatures,
// mow motor, GPS accuracy, ...) as last sent with the live pose. The server
// only includes them when they changed, so a payload without `sensors` keeps
// the previous values.
export const robotSensors = writable([]);

export function ingestRobotSensors(payload) {
  if (Array.isArray(payload?.sensors)) robotSensors.set(payload.sensors);
}

export function clearRobotSensors() {
  robotSensors.set([]);
}
