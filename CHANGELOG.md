# Changelog

## v2.4.1 — Trail phase coloring & auto-clear on new mow

### Added
- **Movement trail colored by phase** — both the saved trail and the live
  session breadcrumb now color each point by what the mower was doing:
  dark blue while docking/undocking, light blue while mowing (a neutral
  color otherwise). Segments stay visually connected across a color change.
- **Saved trail auto-clears when a new mow starts** — the moment the mower
  transitions into mowing from anything else, the previous saved history is
  cleared (backed up first, like the manual **Clear** button) so re-mowing
  the same area starts a fresh, readable trail instead of piling passes on
  top of each other.

### Fixed
- **Saved trail phases now survive a server restart** — the history loader
  was rebuilding each point from disk without its `phase` field, silently
  dropping the phase coloring data on every reload.

### Changed
- **Saved trail line is thicker, more opaque, and more visible** —
  previously a muted 1px-dot gray line that barely showed up against
  satellite imagery.

## v2.4.0 — Persisted movement trail & shared capture toggles

The movement trail is now saved to the mower like the WiFi survey already
was, and both features get the same on/off model: a main toggle that starts
or stops recording (shared, persisted, affects every browser), and a nested
toggle that only controls whether *this browser* draws the overlay.

### Added
- **Persisted movement trail** — the mower now records its own position
  history to a shared file (`ROBOT_TRAIL_PATH`, default
  `/data/ros/movement-trail.json`), autonomously and independent of any
  single browser, mirroring the WiFi survey's collector. New
  `GET/POST /api/robot-trail`, `POST /api/robot-trail/capture`, and
  `DELETE /api/robot-trail` endpoints. Points are spaced at least
  `ROBOT_TRAIL_MIN_DISTANCE_M` apart and capped at `ROBOT_TRAIL_MAX_POINTS`.
  The saved history renders as a dashed line, with breaks shown wherever the
  gap between consecutive points exceeds two minutes.
- **Shared capture toggles for WiFi signal map and movement trail** — each
  panel's main toggle now starts/stops that feature's server-side capture
  (persists across restarts, shared by every browser) instead of being a
  local display preference. A nested toggle, shown once capture is on,
  independently controls whether this browser overlays it on the map. Both
  panels get a matching **Clear** button under their overlay toggle.

### Fixed
- **Turning off Live robot no longer disables the WiFi signal map** —
  Live robot's fatal-pose handler used to force the WiFi toggle off as a
  side effect, back when that toggle was a harmless local preference; now
  that it's a shared, persisted capture switch, a single browser's transient
  pose failure was incorrectly shutting off WiFi capture for everyone. The
  cascade is removed; a stale in-flight pose response can also no longer
  clobber a more recent manual toggle.
- **WiFi icon color now matches the on/off convention used everywhere else**
  — it was reading a dynamic signal-strength color instead of the shared
  on/off color, so it rendered a visibly different green than the Live robot
  and Movement trail icons even when all three were "on."
- **Zoom controls can no longer end up hidden behind the mower-control /
  tool-dock stack** — that stack is now coordinated live with the robot HUD
  above it: as the HUD grows, the stack is pushed down, then reflowed to two
  columns, and only as a last resort does the HUD itself start scrolling —
  in every case the zoom buttons' bottom-right position is treated as a hard
  boundary the stack may never be pushed into.

### Changed
- **"Clear" buttons unified** — the WiFi survey's and movement trail's clear
  buttons now share the same label, placement (directly under their overlay
  toggle), and right-aligned style, instead of the WiFi one looking
  different from the trail one.

### Internal
- `atomicWriteOwnedFile` / `backupBeforeClear` helpers extracted in
  `server.js`, replacing byte-for-byte duplicated tmp-write/chown/rename and
  copy-before-clear logic that the WiFi survey and movement-trail flush/clear
  paths had each implemented separately.
- New `ROBOT_TRAIL_PATH`, `ROBOT_TRAIL_MIN_DISTANCE_M`,
  `ROBOT_TRAIL_MAX_POINTS`, `ROBOT_TRAIL_FLUSH_MS`,
  `ROBOT_TRAIL_COLLECTOR_DISABLE` env vars, documented in the README
  alongside the existing `WIFI_MAP_*` ones.

## v2.3.0 — Live movement trail

A breadcrumb trail of the live robot's recent positions, so you can see where
it's actually been, not just where it is right now — similar to the
OpenMower app's live view.

### Added
- **Movement trail** — an optional overlay toggled from the **Live robot**
  panel, drawn as a line on the map. Client-side only: points are kept while
  **Live robot** is on, spaced at least 0.15 m apart (decoupling trail detail
  from the ~48 Hz pose stream), and bounded to the last 10 minutes / 3,000
  points regardless. Turning either **Live robot** or **Movement trail** off
  clears it; a **Clear** button resets it manually. Shows a running point
  count and elapsed span while active.

### Changed
- **Live robot's status dot removed** — its on/waiting/off color now lives on
  the row's icon itself instead of a separate dot, matching how the WiFi
  signal map and Movement trail rows already indicate state.

### Internal
- `src/lib/robot/trail.js` — pure, tested buffer helpers (`appendTrailPoint`,
  `pruneTrail`) shared by the trail store; no server or API changes.

## v2.2.1 — WiFi heatmap cell-size fix

The WiFi heatmap always rendered every sample dot at a hardcoded 2.2 m radius,
so `WIFI_MAP_CELL_SIZE_M` had no visible effect no matter what it was set to
— reported by a user who tried values from `0.75` down to `0.1` with zero
visual change.

### Fixed
- **Heatmap dot size now follows the configured cell size** — the renderer
  derives the dot radius from the server-reported `cellSizeM` instead of a
  fixed constant (`radius = cellSizeM * 3`, chosen so the default `0.75 m`
  setting still renders ~identically to the old hardcoded value — a no-op for
  anyone who's never touched the setting).
- **Out-of-range `WIFI_MAP_*` values are no longer silently clamped** — all
  five numeric env vars (`WIFI_MAP_CELL_SIZE_M`, `WIFI_MAP_MAX_POINTS`,
  `WIFI_MAP_FLUSH_MS`, `WIFI_MAP_COLLECTOR_INTERVAL_MS`,
  `WIFI_MAP_COLLECTOR_CELL_REVISIT_MS`) now log a startup `WARN` naming the
  value that was actually used when a setting falls outside its allowed
  range — e.g. `WIFI_MAP_CELL_SIZE_M=0.1` now logs that it was clamped up to
  the `0.25 m` minimum, instead of quietly doing nothing. Also fixes a latent
  bug where explicitly setting a value to `0` was treated as "unset" and
  silently replaced with the default, rather than being clamped to the
  minimum like any other out-of-range value.

### Internal
- Heatmap re-renders are now triggered by a `cellSizeM`-specific derived
  store instead of the whole `wifiSurveyStorage` object, so a routine 15s
  survey poll no longer tears down and rebuilds every heatmap dot when
  nothing about the grid actually changed.

## v2.2.0 — WiFi signal survey

A shared, mower-side WiFi heatmap: the editor now records real radio signal strength
alongside the live pose and paints it on the map, autonomously and without a browser
open.

### Added
- **WiFi signal map** — an optional heatmap overlay showing WiFi dBm readings, toggled
  from the **Live robot** panel. The server runs a persistent `rospy` collector inside
  `open_mower_ros` that samples `/proc/net/wireless` alongside the fused pose every 10 s
  (`WIFI_MAP_COLLECTOR_INTERVAL_MS`), merges readings into spatial cells (`0.75 m` by
  default, `WIFI_MAP_CELL_SIZE_M`), and persists the survey centrally to
  `/data/ros/wifi-signal-map.json` so every browser sees the same shared data — no open
  browser required to keep recording.
- **Browser fallback recording** — if the autonomous collector is disabled
  (`WIFI_MAP_COLLECTOR_DISABLE=1`) or unreachable, an open browser with **Live robot**
  on continues to record readings from the live pose stream.
- New endpoints: `GET /api/wifi-map`, `POST /api/wifi-map/samples`,
  `DELETE /api/wifi-map` (clears the shared survey, with an automatic backup first).

### Changed
- **Faster, quieter reconnects** — both the WiFi collector and the live pose stream now
  react to Docker container-start events for `open_mower_ros` instead of relying only on
  blind polling, so recovery after a ROS restart is near-instant. The poll loop remains
  as a slow fallback and now logs its retry warning sparingly instead of on every
  attempt.
- The **WiFi signal map** toggle turns itself off — with the same toast pattern as
  **Live robot** — when the live pose reports a fatal error (ROS container missing, not
  running, or pose disabled), since the browser-fallback path depends on the same pose
  stream.

### Internal
- Fixed a ROS helper process leak: stopping the pose stream or WiFi collector (including
  on graceful shutdown via `SIGTERM`/`SIGINT`, now handled explicitly) terminates the
  in-container Python process instead of only closing the local exec stream.
- Multi-arch Docker build now compiles the (architecture-independent) frontend on
  `BUILDPLATFORM`, avoiding QEMU emulation of npm's native helpers for `arm64` images.

### Safety & requirements
- The autonomous collector requires `open_mower_ros` to use host networking (the
  standard OpenMower OS v2 default) so `/proc/net/wireless` reflects the mower's real
  WiFi interface. Missing pose, map bounds, or in-container commands are reported in
  `storage.collector.lastError`; normal map operations continue working if collection is
  unavailable.

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
