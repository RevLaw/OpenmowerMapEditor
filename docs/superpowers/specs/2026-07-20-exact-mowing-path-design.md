# Exact mowing path — design

Render the **literal** coverage path OpenMower will drive, by calling the robot's
own `slic3r_coverage_planner` service — not the editor's fast approximation.

## Goal & scope

- On demand, for the **selected mow zone**, fetch the real planner output and draw
  it on the map (outline laps + fill, in drive order).
- Keep the existing instant JS approximation as the default live/offline preview.
- Read-only with respect to the robot: planning never commands motion.

Out of scope: planning all zones at once; editing the path; persisting it.

## Service interface (verified on the mower)

`slic3r_coverage_planner/PlanPath` request:
`fill_type` (0=LINEAR,1=CONCENTRIC), `angle` (rad), `distance` (line spacing),
`outer_offset`, `outline_count`, `outline_overlap_count`, `skip_*` bools,
`outline` (geometry_msgs/Polygon), `holes` (Polygon[]).

Response: `paths[]` of `{ is_outline:uint8, path: nav_msgs/Path }` — each pose has
map-frame x/y (drive order). We flatten poses to `[x,y]`; the polyline carries
direction.

OpenMower's `MowingBehavior.cpp` builds the request as: `angle` = per-area or
auto-detected base + global `mow_angle_offset` (absolute mode replaces it);
`outline_count`/`outline_overlap_count` = per-area override or global; `outline` =
mow polygon; `holes` = the area's obstacles; `fill_type` = FILL_LINEAR;
`outer_offset` = per-area or global; `distance` = `tool_width`. We replicate this.

## Backend

- **rospy script** (`PLAN_PATH_PY`), run once per request via `dockerExecInContainer`
  in the pose container. Reads base64-JSON request from an env var, builds the
  PlanPath request, `wait_for_service` + call, prints
  `{ok:true, paths:[{is_outline:bool, pts:[[x,y]...]}], stats:{laps,fillRows,points}}`
  or `{ok:false, error}`. ROS sourcing via the same bash wrapper as the pose stream.
- **`POST /api/plan_path`** — body `{outline, holes, angle, distance, outer_offset,
  outline_count, outline_overlap_count, fill_type?}`. Guards: `poseDisabled`,
  container running. ~25 s exec timeout. Short-TTL in-memory cache keyed by a hash
  of the request so identical re-clicks are instant. Returns the parsed JSON.

## Frontend

- `src/lib/coverage/planRequest.js` (pure, unit-tested):
  - `buildPlanRequest(area, areas, mowParams)` → the POST payload (resolves angle,
    distance, offset, laps, overlap; collects contained obstacles as holes via
    `bestContainingMowAreaIndex`).
  - `parsePlanResponse(json)` → `{ paths:[{isOutline, pts}], stats }`.
- `src/lib/stores/exactPath.js` — `exactPath` writable `{ paths, stats, rev, areaIndex } | null`,
  `exactPathLoading` writable, and `computeExactPath()` / `clearExactPath()` actions
  (call `api.planPath`, stamp with current editor rev + areaIndex, toast on error).
- `src/lib/api.js` — `planPath(payload)` POST helper.
- **CoveragePanel (Mowing panel):** for a mow zone, a **Compute exact path** button
  (disabled while loading), a one-line status (`3 laps + fill · 1,240 pts`, or error,
  or *"edited — recompute"* when `editor.rev !== exactPath.rev`), and a **Clear**.
- **mapController:** subscribe to `exactPath`; draw a dedicated layer — green (`--ok`)
  for `isOutline`, cyan (`--accent-2`) for fill — plus a start dot. Convert x/y →
  latlng via `origin()`. Redraw on projection change; leave drawn (not auto-cleared)
  on edits.

## Error handling

Mower unreachable / container down / service timeout / empty plan → `ok:false` with
a human message shown in the panel + a toast; no overlay drawn. The approximation is
never affected, so offline use is unchanged.

## Testing

- Unit tests for `buildPlanRequest` (params resolution + hole collection) and
  `parsePlanResponse` (JSON → polylines, is_outline split, stats).
- The rospy/docker/service path is validated live on the mower over SSH (read-only
  planning call) since it needs ROS; it cannot run in local CI.

## Files touched

`server.js` (script + endpoint + cache), `src/lib/api.js`,
`src/lib/coverage/planRequest.js` (+ test), `src/lib/stores/exactPath.js`,
`src/components/panels/CoveragePanel.svelte`, `src/map/mapController.js`, README.
