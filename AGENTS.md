# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. This file
covers *how* to write and navigate the code. For *what* to run day-to-day
(build/test/lint commands) and the big-picture architecture, see
[CLAUDE.md](./CLAUDE.md) — read both before making changes.

## Project overview

OpenMower Map Editor is a browser-based editor for OpenMower's `map.json`
zone/geometry format. A Svelte 5 SPA (compiled to static assets by Vite) talks
to a small Express 5 backend that reads/writes the map file on disk and, when
a Docker socket is mounted, reaches into the mower's ROS container for live
telemetry, path planning, and control. See the root [README.md](./README.md)
for the full feature list, deployment instructions, and environment variable
reference — don't duplicate that here.

## Repository walkthrough

Read files in roughly this order when getting oriented:

1. **`src/lib/format/mapFormat.js`** — the `map.json` shape (`areas[]`,
   `docking_stations[]`) and the helpers every editing feature builds on
   (clone, parse, zone id generation, editor-only metadata under
   `properties`). Start here — everything else operates on this shape.
2. **`src/lib/stores/editor.js`** — the single Svelte store holding the
   in-memory map, selection state, and undo/redo history. Every edit action
   (drag, add point, transform, zone CRUD) is a method on this store. If
   you're adding a new editing action, it goes here.
3. **`src/lib/geo/`** — framework-free, unit-tested geometry: projection
   (lat/lng ⟷ local meters), polygon math, offset/simplify, coverage-path
   approximation, and the interactive tools (`geo/tools/brush.js`,
   `geo/tools/snap.js`). No DOM or Leaflet imports here by design — this is
   what `npm test` covers most heavily.
4. **`src/map/mapController.js`** — the Leaflet integration layer. Subscribes
   to the editor store and renders/updates markers, polylines, and overlays;
   translates raw mouse/touch events into store actions. This is the seam
   between "pure logic" and "browser rendering."
5. **`src/components/`** — Svelte UI: `AppShell.svelte` is the root layout;
   `components/panels/` holds sidebar panels (Mowing, Transform, Create,
   etc.); `ToolDock.svelte`, `CommandPalette.svelte`, `RobotHud.svelte` are
   the other major interactive surfaces.
6. **`server.js`** — single-file Express backend. It's long but organized
   top-to-bottom as: logging helpers → WiFi-survey merge/persistence →
   Docker Engine API client (`dockerApiRequest`) → shell scripts that get
   piped into `docker exec` for ROS interaction (pose probe, live pose
   stream, path planning, mow params, control) → the autonomous WiFi
   collector + Docker container-event watcher → route handlers at the
   bottom (`app.get`/`app.post`/`app.delete`). When adding a backend
   feature, find the nearest existing route handler and follow its pattern
   rather than inventing a new one.

Two request lifecycles worth understanding end-to-end before touching robot
features:

- **Live pose**: browser opens `GET /api/robot_pose/stream` (SSE) →
  `server.js` starts (or reuses) a persistent `rospy` subscriber inside the
  ROS container via a long-lived `docker exec` → each sample is parsed and
  broadcast to all connected SSE clients → `src/lib/robot/interpolate.js`
  smooths the ~48 Hz-ish samples into a per-frame animation client-side.
  Falls back to `tf2_echo`/`tf_echo` polling, then to plain `GET
  /api/robot_pose` polling, if streaming isn't available. The same stream
  also feeds the movement trail (below) via `ingestLiveTrailPoint`.
- **WiFi survey**: a separate persistent collector (also a fixed-name
  `docker exec` subprocess) samples `/proc/net/wireless` on an interval,
  merges into spatial cells (`src/lib/wifi/signal.js` mirrors the cell/color
  math client-side), and flushes to `/data/ros/wifi-signal-map.json` at most
  once per flush interval. Browsers poll `GET /api/wifi-map?revision=<n>`
  and only re-fetch points when the revision changed. Capture is a shared,
  persisted on/off toggle (`POST /api/wifi-map/capture`), independent from
  the per-browser heatmap-overlay display toggle.
- **Movement trail**: distinct from the client-only breadcrumb in
  `src/lib/robot/trail.js` (this session's last 10 min / 3,000 points,
  cleared when Live robot turns off). The *persisted* trail is
  server-side: every live-pose sample is throttled by distance and appended
  to `ROBOT_TRAIL_PATH`, tagged with a `docking`/`mowing`/null phase for
  coloring. A rising edge into "mowing" archives the finished session to a
  dated file (`GET /api/robot-trail/archive[/:id]`) and starts a fresh
  history, so re-mowing the same area doesn't pile up on old passes.
  `src/lib/stores/robotTrail.js` mirrors the WiFi store's shared-state/local-toggle
  split and revision-aware polling pattern.

A third mower-side persisted/shared-state feature should build on the two
factories this pattern was refactored into rather than re-copying it:
`createFlushScheduler` in `server.js` (debounced atomic-write scheduling) and
`createCaptureSync` in `src/lib/stores/captureSync.js` (revision-aware sync +
epoch-guarded optimistic capture toggle).

## Coding conventions

Match the existing style exactly — there is no linter/formatter configured,
so consistency is enforced by convention, not tooling:

- **JavaScript, not TypeScript.** No type annotations, no `.ts` files.
- Semicolons on every statement; double quotes for strings; 2-space
  indentation.
- `const`/`let` only, never `var`. Prefer `const`; use `let` only when a
  binding is genuinely reassigned.
- One-line JSDoc (`/** ... */`) above exported functions in `src/lib/**`
  where the *why* or a non-obvious contract isn't clear from the name and
  signature alone — see `src/lib/geo/geometry.js` for the pattern. Don't add
  multi-line docstrings or restate what the code already says.
- Keep `src/lib/geo/**` and `src/lib/format/**` framework-free (no Svelte,
  no Leaflet, no DOM APIs) so they stay unit-testable in plain Node. UI
  wiring belongs in `src/components/` or `src/map/mapController.js`, not in
  `lib/`.
- Svelte state lives in `src/lib/stores/*.js` as plain `writable`/`derived`
  stores, one concern per file (`dirty.js`, `theme.js`, `wifi.js`, …).
  Components subscribe to stores; they don't hold editing state themselves.
- Backend: prefer small top-level functions over deeply nested callbacks in
  `server.js`; route handlers stay thin and delegate to a named helper
  function placed above them (see `mergeWifiSurveySample`, `dockerApiRequest`
  for the pattern). Log via the existing `logInfo`/`logWarn`/`logError`
  helpers, not raw `console.*`, and keep noisy logs behind
  `OPENMOWER_VERBOSE_LOGS`.
- New backend config knobs follow the existing `OPENMOWER_*` / `WIFI_MAP_*` /
  `ROBOT_TRAIL_*` environment-variable naming and must be documented in the README's
  Environment Variables table (not just in code).
- Never hand-edit files under `ros/` or `params/` as part of a code change —
  those are runtime/local data (mower's live `map.json`, backups, params
  YAML), not source.

## Testing instructions

- Tests live next to the code they cover as `*.test.js` (Vitest, `happy-dom`
  for the one component smoke test) — see `src/lib/geo/geometry.test.js`,
  `src/lib/format/mapFormat.test.js`, etc.
- Run the full suite with `npm test`; use `npm run test:watch` while
  iterating. Run a single file with `npx vitest run src/lib/geo/geometry.test.js`.
- Pure logic in `src/lib/geo/` and `src/lib/format/` should be covered by
  fast, dependency-free unit tests — that's the majority of existing
  coverage and the bar for new geometry/format code.
- `server.test.js` (repo root, alongside `server.js`) unit-tests its
  pure/stateless helpers (day-boundary math, sample/point validation and
  merging, env-var clamping) by `require()`-ing `server.js` directly —
  `require.main === module` guards the real `app.listen()`/Docker/signal
  wiring so this never binds a port. It does not cover HTTP routes or
  Docker/ROS interaction; verify those manually against the local-dev
  command in [CLAUDE.md](./CLAUDE.md#commands).

## Commit / PR conventions

- Commit subjects are short and imperative, often prefixed `feat:`, `fix:`,
  `build:`, or `docs:` (plain descriptive subjects are also used — match
  whichever style the recent history around your change uses; check `git
  log --oneline -10`).
- Release commits are tagged `vX.Y.Z — <headline>` and pair with a
  `CHANGELOG.md` entry and a README/version bump — see recent history for
  the pattern. Don't bump the version yourself unless asked.

## Security notes for changes touching Docker/ROS

Anything that shells out via `dockerApiRequest`/`docker exec` runs with the
same privileges as root on the host (the socket is mounted). When adding or
modifying these paths:

- Never build shell command strings by concatenating unsanitized input;
  follow the existing pattern of fixed script templates with narrowly
  validated parameters (see `isValidMapFileName`, `shouldRestartFromQuery`).
- Keep new remote-control-capable endpoints behind a disable flag, following
  `OPENMOWER_CONTROL_DISABLE`.
