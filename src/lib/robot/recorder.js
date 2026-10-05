// Pure helpers for turning robot positions into zone outlines: recording a
// boundary while driving the mower around it, and converting a stretch of the
// saved movement trail into a zone. Unlike lib/robot/trail.js there is no age
// or count pruning — every kept point belongs to the outline being traced.
import { distance, simplify, polygonArea, pointToSegmentDistance } from "../geo/geometry.js";

export const RECORD_MIN_DISTANCE_M = 0.1;
export const MAX_RECORDED_POINTS = 20000;

/**
 * Append a pose to a recording when the robot moved at least `minDist` from
 * the last kept point. Returns the same array when the pose was dropped.
 */
export function appendRecordedPoint(points, pose, minDist = RECORD_MIN_DISTANCE_M) {
  if (!Number.isFinite(pose?.x) || !Number.isFinite(pose?.y)) return points;
  const last = points[points.length - 1];
  if (last && distance(last, pose) < minDist) return points;
  if (points.length >= MAX_RECORDED_POINTS) return points;
  return [...points, { x: pose.x, y: pose.y }];
}

/** Slice a point list by fractional start/end positions (0..1), inclusive. */
export function slicePath(points, startFrac, endFrac) {
  if (!Array.isArray(points) || !points.length) return [];
  const n = points.length;
  const a = Math.max(0, Math.min(n - 1, Math.round(Math.min(startFrac, endFrac) * (n - 1))));
  const b = Math.max(0, Math.min(n - 1, Math.round(Math.max(startFrac, endFrac) * (n - 1))));
  return points.slice(a, b + 1).map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Turn a driven path into a closed-zone outline: drop the closing overlap
 * (driving back to the start), then simplify. Returns null when the path
 * doesn't enclose a usable area.
 */
export function pathToOutline(points, tolerance = 0.05, closeDist = 0.5) {
  if (!Array.isArray(points) || points.length < 3) return null;
  let pts = points.map((p) => ({ x: p.x, y: p.y }));
  // Trim the tail where the driver returned onto the start point.
  while (pts.length > 3 && distance(pts[pts.length - 1], pts[0]) < closeDist) pts.pop();
  if (tolerance > 0) {
    pts = simplify(pts, tolerance);
    // Simplify keeps the path's two ends; on a closed ring they're often just
    // points along the closing edge — drop them when they're collinear.
    while (pts.length > 3 && pointToSegmentDistance(pts[pts.length - 1], pts[pts.length - 2], pts[0]) <= tolerance) pts.pop();
    while (pts.length > 3 && pointToSegmentDistance(pts[0], pts[pts.length - 1], pts[1]) <= tolerance) pts.shift();
  }
  if (pts.length < 3 || polygonArea(pts) < 0.05) return null;
  return pts;
}

/** Length (m) of an open path. */
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < (points?.length || 0); i += 1) total += distance(points[i - 1], points[i]);
  return total;
}
