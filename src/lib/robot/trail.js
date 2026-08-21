// Pure helpers for the live-robot breadcrumb trail: turn the raw, up-to-48Hz
// pose stream into a bounded set of map-frame points worth drawing. Decouples
// trail resolution from pose rate (only keep a point once the robot has moved
// far enough) and bounds memory by both age and count. No DOM here.

import { distance } from "../geo/geometry.js";

export const MIN_TRAIL_DISTANCE_M = 0.15;
export const MAX_TRAIL_AGE_MS = 10 * 60 * 1000;
export const MAX_TRAIL_POINTS = 3000;

/** Drop points older than MAX_TRAIL_AGE_MS, then enforce MAX_TRAIL_POINTS. */
export function pruneTrail(trail, now = Date.now()) {
  if (!Array.isArray(trail) || !trail.length) return trail || [];
  const cutoff = now - MAX_TRAIL_AGE_MS;
  let start = 0;
  while (start < trail.length && trail[start].t < cutoff) start += 1;
  const trimmed = start > 0 ? trail.slice(start) : trail;
  return trimmed.length > MAX_TRAIL_POINTS
    ? trimmed.slice(trimmed.length - MAX_TRAIL_POINTS)
    : trimmed;
}

/**
 * Append a pose to the trail if it's far enough from the last kept point.
 * Returns the same array reference when the point is dropped (too close),
 * so callers can skip a store update.
 */
export function appendTrailPoint(trail, point, now = Date.now()) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return trail;
  const list = Array.isArray(trail) ? trail : [];
  const last = list[list.length - 1];
  if (last && distance(last, point) < MIN_TRAIL_DISTANCE_M) return list;
  return pruneTrail([...list, { x: point.x, y: point.y, t: now }], now);
}
