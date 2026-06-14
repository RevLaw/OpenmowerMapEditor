// Mowing coverage preview: fill a polygon with parallel "stripes" at a given
// spacing and angle, clipped to the outline and carved by obstacle holes.
// Visual only. Pure (meters in, meters out) and unit-testable.
import { isPointInsidePolygon } from "./geometry.js";

const MAX_LINES = 5000; // guard against absurd spacing on huge zones

/**
 * @param {Array<{x:number,y:number}>} outline  mow zone (editable points, m)
 * @param {Array<Array<{x:number,y:number}>>} obstacles  holes inside the zone
 * @param {number} spacing  line spacing (m)
 * @param {number} angleDeg  stripe direction (deg)
 * @returns {Array<{a:{x:number,y:number}, b:{x:number,y:number}}>} segments
 */
export function coverageLines(outline, obstacles, spacing, angleDeg) {
  if (!outline || outline.length < 3 || !(spacing > 0)) return [];

  const ang = ((angleDeg || 0) * Math.PI) / 180;
  // Rotate the world by -ang so the stripes become horizontal scanlines.
  const c = Math.cos(-ang);
  const s = Math.sin(-ang);
  const rot = (p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const cb = Math.cos(ang);
  const sb = Math.sin(ang);
  const unrot = (p) => ({ x: p.x * cb - p.y * sb, y: p.x * sb + p.y * cb });

  const ring = outline.map(rot);
  const holes = (obstacles || []).filter((o) => o && o.length >= 3).map((o) => o.map(rot));

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minY) || (maxY - minY) / spacing > MAX_LINES) return [];

  const crossings = (poly, y) => {
    const xs = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    return xs;
  };

  const segments = [];
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    const xs = crossings(ring, y);
    holes.forEach((h) => xs.push(...crossings(h, y)));
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 1) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      if (x1 - x0 < 1e-6) continue;
      const mid = { x: (x0 + x1) / 2, y };
      if (isPointInsidePolygon(mid, ring) && !holes.some((h) => isPointInsidePolygon(mid, h))) {
        segments.push({ a: unrot({ x: x0, y }), b: unrot({ x: x1, y }) });
      }
    }
  }
  return segments;
}
