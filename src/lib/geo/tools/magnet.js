// Magnetic snapping: pull a dragged/placed point onto a nearby vertex or edge
// of other zones so neighbouring outlines line up without gaps or overlaps.
// (Distinct from tools/snap.js, which straightens a vertex range.)
import { distance } from "../geometry.js";

/** Closest point to `p` on segment a-b. */
export function closestPointOnSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  let t = lenSq > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * vx, y: a.y + t * vy };
}

/**
 * Snap `p` to the nearest target within `tolerance` meters. Vertices win over
 * edges (a corner is almost always what the user is aiming for).
 * @param {{x:number,y:number}} p
 * @param {Array<Array<{x:number,y:number}>>} rings  closed rings as open point arrays
 * @param {number} tolerance  meters
 * @param {Array<{x:number,y:number}>} [extraPoints]  stand-alone snap targets (e.g. dock)
 * @returns {{point:{x:number,y:number}, kind:'vertex'|'edge'}|null}
 */
export function magnetSnap(p, rings, tolerance, extraPoints = []) {
  if (!p || !(tolerance > 0)) return null;
  let best = null;
  let bestD = tolerance;
  const tryVertex = (v) => {
    const d = distance(p, v);
    if (d <= bestD) {
      bestD = d;
      best = { point: { x: v.x, y: v.y }, kind: "vertex" };
    }
  };
  for (const ring of rings) for (const v of ring) tryVertex(v);
  for (const v of extraPoints) if (v) tryVertex(v);
  if (best) return best;

  for (const ring of rings) {
    const n = ring.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i += 1) {
      const q = closestPointOnSegment(p, ring[i], ring[(i + 1) % n]);
      const d = distance(p, q);
      if (d <= bestD) {
        bestD = d;
        best = { point: q, kind: "edge" };
      }
    }
  }
  return best;
}
