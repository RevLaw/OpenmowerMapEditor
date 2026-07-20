// Pure helpers for the "exact path" feature: turn the selected mow zone + its
// resolved parameters into the /api/plan_path request, and turn the planner's
// JSON response into polylines. Mirrors OpenMower's MowingBehavior.cpp request
// build so the preview matches what the robot actually drives. No DOM here.

import { getAreaType, getZoneOverrides } from "../format/mapFormat.js";
import { getEditablePoints } from "../format/outline.js";
import { centroid, bestContainingMowAreaIndex } from "../geo/geometry.js";
import { resolveMowSettings } from "./mowSettings.js";

const toXY = (pts) => pts.map((p) => [p.x, p.y]);

/**
 * Build the POST /api/plan_path body for the mow zone at `areaIndex`.
 * Resolves per-zone overrides against the global mowParams, applies OpenMower's
 * angle rule (base = fixed override or auto-detect; + global offset unless the
 * robot is in absolute mode), and collects contained obstacles as holes.
 * Returns null when the zone is missing or not a valid mow polygon.
 */
export function buildPlanRequest(areaIndex, areas, mowParams) {
  const area = areas?.[areaIndex];
  if (!area || getAreaType(area) !== "mow") return null;
  const pts = getEditablePoints(area.outline || []);
  if (pts.length < 3) return null;

  const ov = getZoneOverrides(area);
  const gp = mowParams || {};
  const { laps, overlap, outerOffset, angleRad } = resolveMowSettings(ov, gp, pts);

  // Obstacles whose centroid falls in THIS mow area become holes (same linkage
  // the validation/obstacle logic uses).
  const holes = [];
  for (let i = 0; i < areas.length; i += 1) {
    if (getAreaType(areas[i]) !== "obstacle") continue;
    const opts = getEditablePoints(areas[i].outline || []);
    if (opts.length < 3) continue;
    const c = centroid(opts);
    if (c && bestContainingMowAreaIndex(c, areas, getAreaType) === areaIndex) {
      holes.push(toXY(opts));
    }
  }

  return {
    fill_type: 0, // FILL_LINEAR — what MowingBehavior uses
    angle: angleRad,
    distance: gp.toolWidth > 0 ? gp.toolWidth : 0.14,
    outer_offset: outerOffset,
    outline_count: laps,
    outline_overlap_count: overlap,
    outline: toXY(pts),
    holes,
  };
}

/** Normalize the planner's JSON into `{ ok, paths:[{isOutline, pts:[{x,y}]}], stats }`. */
export function parsePlanResponse(json) {
  if (!json || !json.ok || !Array.isArray(json.paths)) {
    return { ok: false, error: json?.error || "Planner returned no path", paths: [], stats: null };
  }
  const paths = json.paths
    .map((p) => ({
      isOutline: !!p.is_outline,
      pts: (Array.isArray(p.pts) ? p.pts : [])
        .filter((xy) => Array.isArray(xy) && xy.length >= 2)
        .map((xy) => ({ x: Number(xy[0]), y: Number(xy[1]) })),
    }))
    .filter((p) => p.pts.length >= 2);
  return { ok: true, paths, stats: json.stats || null };
}
