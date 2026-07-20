# Changelog

## v2.1.0 — OpenMower live integration

Deep integration with the running robot: the mowing preview now uses your mower's
**real** settings, the live overlay is **smooth**, you can render the **exact** path
the robot will drive, and you can **control the mower** from the map.

### Added
- **Real-parameter mowing preview** — outline laps + fill drawn from the robot's live
  `/mower_logic` values (`tool_width`, `outline_count`, overlap, `mow_angle_offset`, …)
  via `GET /api/mow_params`, with OpenMower's exact angle logic. Falls back to the
  params file + defaults offline.
- **Per-zone cutting overrides** — set `outline_count`, `outline_overlap_count`,
  `outline_offset`, and `angle` per mow zone in the **Mowing** panel; written to
  `area.properties` in `map.json` (the OpenMower v1.2 feature — no hand-editing).
  Angle is edited in degrees and stored in radians.
- **Exact mowing path** — *Compute exact path* runs OpenMower's real
  `slic3r_coverage_planner` for the selected zone (`POST /api/plan_path`) and overlays
  the literal drive path (outline laps + fill, obstacles cut out as holes).
- **Smooth live robot overlay** — the pose now streams over Server-Sent Events from the
  fused GPS/odometry source (up to ~48 Hz) and is interpolated client-side, replacing
  the old ~5 s polling. A top-down **mower icon** rotates to the true heading; status
  modes (nav / docking / charging / dock-full / emergency / error) show RTK state.
- **Mower control** — a floating bar with **Start**, **Stop**, **Home**, and
  **Reset E-stop** (`POST /api/control`). Start/Home/Reset need a two-step confirm;
  **Stop** is a one-tap emergency stop. Disable with `OPENMOWER_CONTROL_DISABLE=1`.

### Changed
- **Reorganized sidebar** — every panel is collapsible and remembers its state; the
  mowing preview and its settable parameters are merged into one **Mowing** panel; the
  zone picker moved into **Selected zone**.
- **Uniform hover-name labels** on the right-side tool and control bars.
- Disabled/inherited form fields render as quiet read-outs instead of gray boxes.

### API
- New endpoints: `GET /api/mow_params`, `GET /api/robot_pose/stream` (SSE),
  `POST /api/plan_path`, `POST /api/control`. The `map.json` on-disk format is unchanged.

### Internal
- Shared `resolveMowSettings` (mow-angle + override resolution) and `buildRosPythonBash`
  (ROS exec sourcing); removed dead code; hot-path optimizations for the live overlay
  (idle rAF when settled, cached glyph element, icon rebuilt only on change).
- `restart: unless-stopped` for the container.

### Safety & requirements
- Control commands move a real robot with spinning blades — test with the mower on a
  stand or clear area and the physical e-stop within reach.
- Live pose, exact path, and control require the Docker socket mount and the
  `open_mower_ros` container. Deploy only on a trusted network.
