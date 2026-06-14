// Generators for quick-draw zone outlines. Return open editable-point arrays
// (the editor re-closes the ring on commit).

/** Rectangle from two opposite corners (meters). */
export function rectangleOutline(a, b) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Regular polygon approximating a circle of `radius` m around `center`. */
export function circleOutline(center, radius, segments = 32) {
  const n = Math.max(8, Math.min(128, Math.round(segments)));
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    pts.push({
      x: center.x + Math.cos(t) * radius,
      y: center.y + Math.sin(t) * radius,
    });
  }
  return pts;
}
