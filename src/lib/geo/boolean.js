// Polygon boolean operations (merge / subtract / clip / split) on open
// editable-point arrays, backed by polygon-clipping. OpenMower outlines are
// simple rings without holes, so every result is reduced to its outer rings:
// one output outline per resulting polygon, largest first.
import polygonClipping from "polygon-clipping";
import { polygonArea, boundingBox } from "./geometry.js";

const MIN_RESULT_AREA = 0.01; // m² — drop slivers left over by the clipper

function toRing(points) {
  const ring = points.map((p) => [p.x, p.y]);
  if (ring.length) ring.push([points[0].x, points[0].y]);
  return ring;
}

function fromRing(ring) {
  const pts = ring.map(([x, y]) => ({ x, y }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && first.x === last.x && first.y === last.y) pts.pop();
  return pts;
}

/** Outer rings of a polygon-clipping MultiPolygon, largest first, slivers dropped. */
function outerRings(multi) {
  return multi
    .map((poly) => fromRing(poly[0]))
    .filter((pts) => pts.length >= 3 && polygonArea(pts) >= MIN_RESULT_AREA)
    .sort((a, b) => polygonArea(b) - polygonArea(a));
}

/** Does the result of a boolean op contain holes (which an outline can't store)? */
function hasHoles(multi) {
  return multi.some((poly) => poly.length > 1);
}

/** Union of two outlines. `holes` is true when the merge enclosed a gap that was filled in. */
export function unionOutlines(a, b) {
  const multi = polygonClipping.union([toRing(a)], [toRing(b)]);
  return { outlines: outerRings(multi), holes: hasHoles(multi) };
}

/** `a` minus `b`. `holes` is true when `b` sat fully inside `a` (result would need a hole). */
export function subtractOutline(a, b) {
  const multi = polygonClipping.difference([toRing(a)], [toRing(b)]);
  return { outlines: outerRings(multi), holes: hasHoles(multi) };
}

/** Intersection of two outlines (e.g. clip an obstacle to its mow zone). */
export function intersectOutlines(a, b) {
  const multi = polygonClipping.intersection([toRing(a)], [toRing(b)]);
  return { outlines: outerRings(multi), holes: hasHoles(multi) };
}

/** Do two outlines overlap with a positive shared area? */
export function outlinesOverlap(a, b) {
  return intersectOutlines(a, b).outlines.length > 0;
}

/**
 * Split an outline along the infinite line through `p1`→`p2`. Returns the
 * pieces on each side (largest first); fewer than 2 means the line missed.
 */
export function splitOutline(points, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9 || points.length < 3) return [];
  const bb = boundingBox([...points, p1, p2]);
  // A half-plane big enough to cover the whole outline on one side of the line.
  const reach = (bb.width + bb.height + 1) * 4;
  const ux = dx / len;
  const uy = dy / len;
  const a = { x: p1.x - ux * reach, y: p1.y - uy * reach };
  const b = { x: p1.x + ux * reach, y: p1.y + uy * reach };
  const left = [a, b, { x: b.x - uy * reach, y: b.y + ux * reach }, { x: a.x - uy * reach, y: a.y + ux * reach }];
  const right = [a, b, { x: b.x + uy * reach, y: b.y - ux * reach }, { x: a.x + uy * reach, y: a.y - ux * reach }];
  const ring = [toRing(points)];
  return [
    ...outerRings(polygonClipping.intersection(ring, [toRing(left)])),
    ...outerRings(polygonClipping.intersection(ring, [toRing(right)])),
  ].sort((m, n) => polygonArea(n) - polygonArea(m));
}
