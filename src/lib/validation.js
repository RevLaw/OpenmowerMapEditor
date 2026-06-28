// Geometry validation. Recomputed whenever the map changes; produces a flat
// list of issues with a severity and a click-to-zoom target.
import {
  polygonArea,
  isPointInsidePolygon,
  segmentsIntersect,
  centroid,
  distance,
  bestContainingMowAreaIndex,
} from "./geo/geometry.js";
import { getEditablePoints } from "./format/outline.js";
import { getAreaType } from "./format/mapFormat.js";

const DUP_EPSILON_M = 0.02;

function zoneLabel(area, index) {
  const name = area?.properties?.name?.trim();
  return name || `Zone ${index + 1} (${getAreaType(area)})`;
}

/** Detect a self-intersection among non-adjacent edges of a closed ring. */
function findSelfIntersection(points) {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      // skip the same edge and edges sharing a vertex (incl. ring wrap)
      if (j === i) continue;
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * @param {object} map  the raw map
 * @returns {Array<{id:string, severity:'error'|'warning', message:string,
 *   areaIndex:number|null, pointIndex:number|null}>}
 */
export function validateMap(map) {
  const issues = [];
  const areas = map?.areas || [];

  areas.forEach((area, areaIndex) => {
    const pts = getEditablePoints(area.outline || []);
    const label = zoneLabel(area, areaIndex);

    if (pts.length < 3) {
      issues.push({
        id: `few-${areaIndex}`,
        severity: "error",
        message: `${label} has fewer than 3 points.`,
        areaIndex,
        pointIndex: null,
      });
      return;
    }

    if (polygonArea(pts) < 1e-6) {
      issues.push({
        id: `degenerate-${areaIndex}`,
        severity: "error",
        message: `${label} has zero area (collinear points).`,
        areaIndex,
        pointIndex: null,
      });
    }

    if (findSelfIntersection(pts)) {
      issues.push({
        id: `selfint-${areaIndex}`,
        severity: "warning",
        message: `${label} outline self-intersects.`,
        areaIndex,
        pointIndex: null,
      });
    }

    // Duplicate / near-coincident consecutive vertices
    for (let i = 0; i < pts.length; i += 1) {
      const next = pts[(i + 1) % pts.length];
      if (distance(pts[i], next) < DUP_EPSILON_M) {
        issues.push({
          id: `dup-${areaIndex}-${i}`,
          severity: "warning",
          message: `${label} has near-duplicate points at vertex ${i + 1}.`,
          areaIndex,
          pointIndex: i,
        });
        break;
      }
    }

    // An obstacle should sit inside a mow area to have any effect.
    if (getAreaType(area) === "obstacle") {
      const c = centroid(pts);
      const parent = bestContainingMowAreaIndex(c, areas, getAreaType);
      if (parent == null) {
        issues.push({
          id: `orphan-${areaIndex}`,
          severity: "warning",
          message: `${label} is not inside any mow area.`,
          areaIndex,
          pointIndex: null,
        });
      }
    }
  });

  // Dock sitting inside an obstacle is almost certainly a mistake.
  const dock = map?.docking_stations?.[0]?.position;
  if (dock) {
    areas.forEach((area, areaIndex) => {
      if (getAreaType(area) !== "obstacle") return;
      if (isPointInsidePolygon(dock, area.outline || [])) {
        issues.push({
          id: `dock-in-obstacle-${areaIndex}`,
          severity: "warning",
          message: `Docking station is inside ${zoneLabel(area, areaIndex)}.`,
          areaIndex,
          pointIndex: null,
        });
      }
    });
  }

  return issues;
}
