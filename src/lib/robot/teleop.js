// Pure joystick → velocity mapping for driving the mower from the editor.
// Stick axes are screen-oriented: x right, y up, both in [-1, 1]. No DOM.

// Mirrors teleop_twist_joy's scale_linear / scale_angular in OpenMower (and
// the server-side clamp in server.js).
export const MAX_LINEAR = 0.5; // m/s
export const MAX_ANGULAR = 1.5; // rad/s
const DEADZONE = 0.08;

/** Clamp a stick vector into the unit circle. */
export function clampStick(x, y) {
  const len = Math.hypot(x, y);
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}

// Deadzone, then a squared response curve: fine control near the centre,
// full speed at the edge.
function shape(v) {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  const t = (a - DEADZONE) / (1 - DEADZONE);
  return Math.sign(v) * t * t;
}

/**
 * Stick position → { lx (m/s, forward +), az (rad/s, left/CCW +) }.
 * `speed` (0..1) scales both. Pushing the stick right turns right (az < 0).
 */
export function stickToTwist(x, y, speed = 0.5) {
  const s = clampStick(Number(x) || 0, Number(y) || 0);
  const k = Math.max(0, Math.min(1, Number(speed) || 0));
  const lx = shape(s.y) * MAX_LINEAR * k;
  const az = -shape(s.x) * MAX_ANGULAR * k;
  return { lx: lx === 0 ? 0 : lx, az: az === 0 ? 0 : az };
}

/** Keyboard (WASD / arrows held) → stick vector. */
export function keysToStick(keys) {
  const has = (k) => keys.has(k);
  const y = (has("w") || has("arrowup") ? 1 : 0) - (has("s") || has("arrowdown") ? 1 : 0);
  const x = (has("d") || has("arrowright") ? 1 : 0) - (has("a") || has("arrowleft") ? 1 : 0);
  return clampStick(x, y);
}
