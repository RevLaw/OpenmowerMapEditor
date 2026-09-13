# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For coding style/conventions and a guided walkthrough of the codebase, see
[AGENTS.md](./AGENTS.md) — read it before making non-trivial changes.

## Commands

```bash
npm install

# Backend (Express) — local dev, pointed at repo-local data files:
PORT=5080 MAP_PATH=./ros/map.json PARAMS_PATH=./params/mower_params.yaml node server.js

# Frontend (Vite + HMR), in a second terminal — proxies /api -> :5080:
npm run dev              # http://localhost:5173

npm test                 # vitest run — full suite
npm run test:watch       # vitest watch mode
npx vitest run src/lib/geo/geometry.test.js   # single test file

npm run build             # compile Svelte app -> dist/
npm start                 # serve built dist/ via Express (production entry)
```

There is no linter or formatter configured (no ESLint/Prettier config in the
repo) — match surrounding style by hand; see AGENTS.md for the conventions.

## Architecture

**Split build/runtime.** The Svelte app is compiled to static assets at build
time (`npm run build` → `dist/`); the Express backend (`server.js`) only
serves `dist/` plus `/api/*` at runtime. This keeps the Raspberry Pi runtime
light — there's no server-side rendering or bundling in production.

**Client layering** (framework-free logic → rendering → UI):

- `src/lib/format/` and `src/lib/geo/` — pure, unit-tested functions
  operating on the `map.json` shape and on `{x,y}` meter coordinates. No
  Svelte/Leaflet/DOM imports. This is the core editing logic and the bulk of
  the test suite.
- `src/lib/stores/editor.js` — the single source of truth for the in-memory
  map, selection, and undo/redo history, built as a Svelte store on top of
  the `lib/format` + `lib/geo` helpers.
- `src/map/mapController.js` — Leaflet rendering + interaction layer;
  subscribes to the editor store and converts pointer/touch events into
  store actions.
- `src/components/` — Svelte UI (shell, sidebar panels, tool dock, command
  palette, robot HUD).

**Backend (`server.js`, single file)** serves the map API and, when the Docker
socket is mounted, bridges to the mower's ROS container:

- Map I/O: `GET/POST /api/map`, `/api/map/backups*` — reads/writes
  `MAP_PATH` with timestamped backups before overwrite.
- Params: `GET /api/params` reads `PARAMS_PATH` (YAML) for the GPS datum;
  `GET /api/mow_params` reads live mowing parameters from `/mower_logic` via
  `docker exec`.
- Live robot telemetry: `GET /api/robot_pose` (poll) and `GET
  /api/robot_pose/stream` (SSE) — backed by one persistent `rospy`
  subscriber streamed out of the ROS container, with a `tf_echo`/topic-poll
  fallback for non-xbot setups.
- Control: `POST /api/control` wraps OpenMower's real
  `high_level_control`/`emergency` services — this can move a physical
  robot; gated by `OPENMOWER_CONTROL_DISABLE`.
- Path planning: `POST /api/plan_path` runs OpenMower's own
  `slic3r_coverage_planner` inside the ROS container for an exact (not
  approximated) coverage path preview. Read-only — never commands motion.
- WiFi survey: `GET/POST/DELETE /api/wifi-map` plus `POST
  /api/wifi-map/capture` (shared on/off toggle) — a separate autonomous
  collector process merges signal samples into spatial cells and persists
  them to `WIFI_MAP_PATH`, independent of any open browser.
- Movement trail: `GET/DELETE /api/robot-trail`, `POST
  /api/robot-trail/capture` (shared on/off toggle), and
  `GET /api/robot-trail/archive[/:id]` for past mow sessions — points are
  appended from the same live-pose subscriber used for robot telemetry,
  persisted to `ROBOT_TRAIL_PATH`, and auto-archived to a dated file
  whenever a new mow starts (or the history is cleared) so past sessions
  stay browsable via the date picker.

All Docker/ROS interaction goes through `dockerApiRequest` (raw Docker Engine
API over the mounted socket) and small fixed shell-script templates piped
into `docker exec` — see AGENTS.md's security notes before changing any of
this.

**Data contract**: the on-disk `map.json` format (`areas[].outline[]`,
`docking_stations[0].position`, per-area `properties` overrides) is a stable
contract shared with OpenMower's firmware — changes to `src/lib/format/` must
stay backward compatible with existing saved maps.
