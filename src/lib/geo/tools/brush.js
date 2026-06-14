// Drag/smear brush: points within `radiusMeters` of the brush center move in
// the direction of the drag (delta), with a linear falloff to the edge. This
// is the intuitive "push points the way I move" behavior. `strength` (0..1)
// scales how strongly points follow the drag. Pure: open editable points in m.

/**
 * @param {Array<{x:number,y:number}>} points  editable points (meters)
 * @param {{x:number,y:number}} center  current brush center
 * @param {{x:number,y:number}} delta  drag movement since the last step (m)
 * @param {number} radiusMeters
 * @param {number} strength  0..1 follow factor at the brush center
 * @returns {{points: Array<{x:number,y:number}>, moved: number}}
 */
export function dragBrush(points, center, delta, radiusMeters, strength) {
  const result = points.map((p) => ({ x: p.x, y: p.y }));
  if (delta.x === 0 && delta.y === 0) return { points: result, moved: 0 };
  let moved = 0;
  for (let i = 0; i < result.length; i += 1) {
    const p = result[i];
    const dist = Math.hypot(p.x - center.x, p.y - center.y);
    if (dist > radiusMeters) continue;
    const influence = 1 - dist / radiusMeters; // linear falloff
    const f = strength * influence;
    if (f <= 0) continue;
    p.x += delta.x * f;
    p.y += delta.y * f;
    moved += 1;
  }
  return { points: result, moved };
}
