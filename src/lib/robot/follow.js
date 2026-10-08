// Route following for go-to: turns the live pose and the remaining waypoints
// into one joystick-style command { lx, az }. Pure — the go-to store calls it
// ~10×/s and sends the result through the normal teleop channel.
import { distance, pointToSegmentDistance } from "../geo/geometry.js";
import { MAX_LINEAR, MAX_ANGULAR } from "./teleop.js";

export const ARRIVE_M = 0.25; // a waypoint this close counts as reached
export const TURN_IN_PLACE_RAD = (35 * Math.PI) / 180;
const TURN_GAIN = 1.8; // rad/s of turn per rad of heading error
const SLOW_DOWN_M = 1; // ease off over the last metre
const MIN_FORWARD = 0.08; // m/s — keep creeping forward when close

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Angle wrapped into (-π, π]. */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Distance left along the route: pose → waypoints[index] → … → last. */
export function remainingDistance(pose, waypoints, index) {
  if (index >= waypoints.length) return 0;
  let total = distance(pose, waypoints[index]);
  for (let i = index + 1; i < waypoints.length; i += 1) total += distance(waypoints[i - 1], waypoints[i]);
  return total;
}

/**
 * One control step toward waypoints[index]. Reached waypoints are skipped; a
 * large heading error turns on the spot so the robot doesn't swing wide past
 * an obstacle corner. Returns { lx, az, index, done }.
 */
export function followStep(pose, waypoints, index, { maxSpeed = 0.3 } = {}) {
  let i = index;
  while (i < waypoints.length && distance(pose, waypoints[i]) <= ARRIVE_M) i += 1;
  if (i >= waypoints.length) return { lx: 0, az: 0, index: waypoints.length, done: true };
  const wp = waypoints[i];
  const error = wrapAngle(Math.atan2(wp.y - pose.y, wp.x - pose.x) - pose.yaw);
  const az = clamp(TURN_GAIN * error, -MAX_ANGULAR, MAX_ANGULAR);
  if (Math.abs(error) > TURN_IN_PLACE_RAD) return { lx: 0, az, index: i, done: false };
  const cap = clamp(Number(maxSpeed) || 0, 0, MAX_LINEAR);
  const ease = Math.min(1, remainingDistance(pose, waypoints, i) / SLOW_DOWN_M);
  const lx = Math.max(Math.min(MIN_FORWARD, cap), cap * ease) * Math.cos(error);
  return { lx, az, index: i, done: false };
}

/** Distance from the pose to the segment being driven (from `start` for the first). */
export function offRouteDistance(pose, waypoints, index, start) {
  if (index >= waypoints.length) return 0;
  const from = index === 0 ? start : waypoints[index - 1];
  return pointToSegmentDistance(pose, from, waypoints[index]);
}
