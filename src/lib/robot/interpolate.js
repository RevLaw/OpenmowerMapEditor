// Pure pose-interpolation helpers for the smooth live robot overlay. The server
// streams discrete pose samples (~20 Hz); the map layer tweens between them each
// animation frame so the marker glides instead of jumping. No DOM/Leaflet here.

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Interpolate an angle (radians) along the shortest path, handling ±π wrap. */
export function lerpAngle(a, b, t) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/** Squared planar distance between two poses (meters²) — cheap jump detection. */
export function poseDist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Move `cur` a fraction `t` (0..1) toward `target`; returns a new pose object. */
export function stepPose(cur, target, t) {
  return {
    x: lerp(cur.x, target.x, t),
    y: lerp(cur.y, target.y, t),
    yaw: lerpAngle(cur.yaw, target.yaw, t),
  };
}
