// Live measurements derived from the map geometry (all metric, since the
// outline coordinates are already in meters).
import {
  polygonArea,
  polygonPerimeter,
  centroid,
  bestContainingMowAreaIndex,
} from "./geo/geometry.js";
import { getEditablePoints } from "./format/outline.js";
import { getAreaType } from "./format/mapFormat.js";

/** Area (m²) and perimeter (m) for a single zone. */
export function zoneMeasurement(area) {
  const pts = getEditablePoints(area?.outline || []);
  return {
    points: pts.length,
    area: polygonArea(pts),
    perimeter: polygonPerimeter(pts),
  };
}

/**
 * Net mowable area: sum of mow zones minus obstacles that fall inside a mow
 * zone. Returns { mow, obstacle, net } in m².
 */
export function totalMowArea(areas = []) {
  let mow = 0;
  let obstacle = 0;
  areas.forEach((area) => {
    const pts = getEditablePoints(area.outline || []);
    const a = polygonArea(pts);
    if (getAreaType(area) === "mow") {
      mow += a;
    } else if (getAreaType(area) === "obstacle") {
      const parent = bestContainingMowAreaIndex(centroid(pts), areas, getAreaType);
      if (parent != null) obstacle += a;
    }
  });
  return { mow, obstacle, net: Math.max(0, mow - obstacle) };
}

/** Human-friendly area string (m² up to 10000, hectares beyond). */
export function formatArea(squareMeters) {
  if (!Number.isFinite(squareMeters)) return "—";
  if (squareMeters >= 10000) {
    return `${(squareMeters / 10000).toFixed(2)} ha`;
  }
  return `${squareMeters.toFixed(squareMeters < 100 ? 2 : 1)} m²`;
}

/** Human-friendly length string. */
export function formatLength(meters) {
  if (!Number.isFinite(meters)) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(meters < 100 ? 2 : 1)} m`;
}
