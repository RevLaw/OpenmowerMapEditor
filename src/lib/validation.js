// Geometry validation. Recomputed whenever the map changes; produces a flat
// list of issues with a severity and a click-to-zoom target.
import {
  polygonArea,
  isPointInsidePolygon,
  segmentsIntersect,
  centroid,
  distance,
  bestContainingMowAreaIndex,
  boundingBox,
  boxesOverlap,
  minRingDistance,
  offsetPolygon,
  signedArea,
  pointToSegmentDistance,
} from "./geo/geometry.js";
import { getEditablePoints } from "./format/outline.js";
import { getAreaType, getZoneName } from "./format/mapFormat.js";

const DUP_EPSILON_M = 0.02;
// Zones whose borders come this close are treated as connected (the robot can
// drive from one into the other). Generous enough for hand-traced seams.
const CONNECT_EPSILON_M = 0.15;
// The dock usually stands right at a zone's border, so allow some slack.
const DOCK_SLACK_M = 1;

function zoneLabel(area, index) {
  return getZoneName(area, index);
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

/** Are two zones connected — overlapping, nested, or with borders (nearly) touching? */
/** Is the dock inside a zone, or within DOCK_SLACK_M of its border? */
function dockNear(dock, z) {
  if (isPointInsidePolygon(dock, z.pts)) return true;
  const n = z.pts.length;
  for (let i = 0; i < n; i += 1) {
    if (pointToSegmentDistance(dock, z.pts[i], z.pts[(i + 1) % n]) <= DOCK_SLACK_M) return true;
  }
  return false;
}

function zonesConnected(za, zb) {
  if (!boxesOverlap(za.box, zb.box, CONNECT_EPSILON_M)) return false;
  if (isPointInsidePolygon(za.pts[0], zb.pts) || isPointInsidePolygon(zb.pts[0], za.pts)) return true;
  return minRingDistance(za.pts, zb.pts) <= CONNECT_EPSILON_M;
}

/**
 * Mow zones the robot can't drive to from the dock: flood-fill over mow + nav
 * zones that touch or overlap, starting from the zones containing the dock.
 */
function unreachableMowZones(zones, dock) {
  const drivable = zones.filter((z) => z.type === "mow" || z.type === "nav");
  const start = drivable.filter((z) => dockNear(dock, z));
  if (!start.length) return [];
  const seen = new Set(start.map((z) => z.index));
  const queue = [...start];
  while (queue.length) {
    const cur = queue.shift();
    for (const z of drivable) {
      if (seen.has(z.index) || !zonesConnected(cur, z)) continue;
      seen.add(z.index);
      queue.push(z);
    }
  }
  return drivable.filter((z) => z.type === "mow" && !seen.has(z.index));
}

/**
 * Would the robot fail to fit inside the zone? Insetting by half the cutting
 * width collapses (or flips) the ring when the zone is narrower than one pass.
 */
function tooNarrow(pts, toolWidth) {
  if (!(toolWidth > 0)) return false;
  const before = signedArea(pts);
  const inset = signedArea(offsetPolygon(pts, toolWidth / 2));
  return Math.sign(inset) !== Math.sign(before) || Math.abs(inset) < toolWidth * toolWidth;
}

/**
 * @param {object} map  the raw map
 * @param {{toolWidth?:number}} [opts]  robot cutting width (m) for the narrow-zone check
 * @returns {Array<{id:string, severity:'error'|'warning', message:string,
 *   areaIndex:number|null, pointIndex:number|null}>}
 */
export function validateMap(map, opts = {}) {
  const issues = [];
  const areas = map?.areas || [];
  const zones = [];

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
    } else {
      // Only real polygons take part in the cross-zone checks below.
      zones.push({ index: areaIndex, type: getAreaType(area), pts, box: boundingBox(pts), label });
    }

    if (getAreaType(area) === "mow" && polygonArea(pts) >= 1e-6 && tooNarrow(pts, opts.toolWidth)) {
      issues.push({
        id: `narrow-${areaIndex}`,
        severity: "warning",
        message: `${label} is narrower than the mower's cutting width (${opts.toolWidth} m).`,
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

  // Note: an obstacle that sticks out over a mow edge is deliberately NOT
  // flagged — OpenMower's coverage planner clips every obstacle to the area
  // it plans (the outside part only keeps blocking navigation, which is
  // usually intended for a tree or bed on the border).

  // Dock sitting inside an obstacle is almost certainly a mistake.
  const dock = map?.docking_stations?.[0]?.position;
  if (dock) {
    const drivable = zones.filter((z) => z.type === "mow" || z.type === "nav");
    if (drivable.length && !drivable.some((z) => dockNear(dock, z))) {
      issues.push({
        id: "dock-outside",
        severity: "warning",
        message: `Docking station is more than ${DOCK_SLACK_M} m outside every mow and nav zone.`,
        areaIndex: null,
        pointIndex: null,
        dock: true,
      });
    } else {
      for (const z of unreachableMowZones(zones, dock)) {
        issues.push({
          id: `unreachable-${z.index}`,
          severity: "warning",
          message: `${z.label} isn't connected to the dock through mow/nav zones — the robot may not reach it.`,
          areaIndex: z.index,
          pointIndex: null,
        });
      }
    }
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
