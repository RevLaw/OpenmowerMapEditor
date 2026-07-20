// Single source of truth for resolving a mow zone's effective cutting settings
// from its per-zone overrides + the robot's global params, matching OpenMower's
// MowingBehavior: an unset override falls back to the global; the mow direction
// is the fixed/auto base plus the global mow_angle_offset (or the offset alone in
// absolute mode). Used by the preview overlay, the panel, and the plan request.

import { firstSegmentAngle } from "../geo/geometry.js";

/**
 * @param {{outlineCount:number|null, outlineOverlapCount:number|null, outlineOffset:number|null, angle:number|null}} ov
 * @param {{outlineCount:number, outlineOverlapCount:number, outlineOffset:number, mowAngleOffset:number, mowAngleOffsetIsAbsolute:boolean}} gp
 * @param {Array<{x:number,y:number}>} pts  editable outline points (for auto angle)
 * @returns {{laps:number, overlap:number, outerOffset:number, baseRad:number, angleRad:number}}
 */
export function resolveMowSettings(ov, gp, pts) {
  const laps = ov.outlineCount ?? gp.outlineCount ?? 0;
  const overlap = ov.outlineOverlapCount ?? gp.outlineOverlapCount ?? 0;
  const outerOffset = ov.outlineOffset ?? gp.outlineOffset ?? 0;
  const baseRad = ov.angle != null ? ov.angle : firstSegmentAngle(pts);
  const offsetRad = ((gp.mowAngleOffset || 0) * Math.PI) / 180;
  const angleRad = gp.mowAngleOffsetIsAbsolute ? offsetRad : baseRad + offsetRad;
  return { laps, overlap, outerOffset, baseRad, angleRad };
}
