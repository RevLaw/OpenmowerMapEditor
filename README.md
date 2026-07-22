# OpenMower Map Editor

Browser-based map editor for OpenMower JSON maps, deployed via Dockge on OpenMower.

Built with **Svelte 5 + Vite 8 + Tailwind CSS 4** (compiled to static assets at build time) and served by a small **Express 5** backend. The compile step runs during the Docker build, so the Raspberry Pi runtime stays light — it only serves the prebuilt `dist/` plus the `/api/*` endpoints.

![OpenMower Map Editor Screenshot](./screenshot1.jpg)

## Features

- Edit OpenMower `areas[].outline[]` points directly on a satellite map
- Drag single points directly (click and drag without selecting a separate handle first)
- Add and remove points
- Add and remove full zones (`mow`, `obstacle`, `nav`)
- Push points along your drag with a smear brush (radius + strength sliders, live cursor preview)
- Lock closed-loop endpoints (first/last point stay synchronized)
- Snap a selected index range to a straight, equally spaced line
- Multi-select points and move them together
- Box select in multi-select mode (`Shift + drag`)
- Move the home station marker (`docking_stations[0].position`)
- Undo/redo history for editing actions (arrow buttons)
- **Command palette** (`Ctrl`/`Cmd + K`) to run any action, and a **keyboard-shortcut** map with an on-screen cheat sheet (`?`)
- **Live measurements** — per-zone area (m²/ha) and perimeter, plus net mowable area (mow minus contained obstacles)
- **Geometry validation** — flags self-intersections, too-few points, degenerate/duplicate vertices, orphan obstacles, and a dock placed inside an obstacle; click an issue to zoom to it
- **Quick create & transform** — draw rectangle/circle zones, place the dock by clicking, duplicate a zone, move a whole zone, rotate/scale about its centroid, **grow/shrink** (offset every border by a margin — a buffer), simplify an outline (Douglas–Peucker), smart add-point on the nearest edge, multi-point delete, and arrow-key nudging
- **Map navigation** — zoom buttons (bottom-right), scroll-wheel / `+` `−` keys, plus zoom in/out and base-map switching from the command palette
- **Switchable base maps** (bottom-left **Layers** control) — Esri satellite (default), the free **20 cm Lower Saxony aerial (DOP20)**, **OpenStreetMap** (global fallback), or a custom XYZ/WMS URL; choice persists. Esri is global but its detailed imagery has coverage gaps in rural regions worldwide (blank tiles past where data exists) — switch to OpenStreetMap or a regional/custom source there. WMS layers render crisp at any zoom; XYZ layers soften past their native zoom (DOP20 is true 20 cm)
- **Mowing coverage preview** — overlay the rows the robot drives: green **outline laps** (driven first) around the edge, then cyan **back-and-forth fill** inside, with obstacles carved out. It uses the robot's **real** parameters: global values read live from `/mower_logic` (`tool_width` = spacing, `outline_count`, `outline_overlap_count`, `mow_angle_offset`, …) via `GET /api/mow_params`, plus any **per-area overrides** in `map.json`, and OpenMower's exact angle logic (first-2 m auto-orientation, or a fixed per-area angle). Falls back to the params file + OpenMower defaults offline
- **Per-area mowing overrides (OpenMower v1.2)** — set `outline_count`, `outline_overlap_count`, `outline_offset`, and `angle` **per mow zone** in the **Mowing** panel (alongside the preview); they're written to `map.json` under `area.properties` (an unchecked control = use the global default). Angle is shown in degrees and stored in radians, and a hint shows the effective direction after the robot's global `mow_angle_offset`. This is the v1.2 area-override feature that otherwise requires hand-editing JSON
- **Exact mowing path (real planner)** — a **Compute exact path** button in the **Mowing** panel runs OpenMower's own `slic3r_coverage_planner` for the selected mow zone (`POST /api/plan_path`) and overlays the **literal** path the robot drives — outline laps (green) + linear fill (cyan) in drive order, with contained obstacles cut out as holes. On-demand and cached; requires the mower online, and flags itself *stale* after you edit. The fast approximation stays the default live/offline preview. Read-only — planning never commands the robot
- **Zone management** — give a zone a friendly **name** (stored as `properties.name`; the random `id` stays as the stable identifier), change its type (mow/obstacle/nav), reorder, and remove it. The zone picker (in the **Selected zone** panel) shows a colored type badge (🟩 mow · 🟥 obstacle · 🟦 nav)
- **Organized sidebar** — panels are **collapsible** and remember their open/closed state (Projection, Transform, and Create start folded); mowing parameters and the coverage preview live together in one **Mowing** panel
- **Unsaved-changes guard** — an "Unsaved" indicator in the sidebar and a browser prompt before you leave with unsaved edits
- Toast notifications and a modern dark-tech / HUD interface with glass map-overlay panels
- Type-aware overlays while editing:
  - editing `mow`: shows `obstacle` (red dashed) and `nav` (blue dashed)
  - editing `obstacle`: shows `mow` (white dashed) and `nav` (blue dashed)
  - editing `nav`: shows `mow` (white dashed) and `obstacle` (red dashed)
- Stable map readability: map colors stay fixed; light/dark toggle changes sidebar UI only
- Optional **live robot** overlay with **smooth motion**: the **Live robot** toolbar button opens an **SSE stream** (`GET /api/robot_pose/stream`). The server holds **one persistent ROS subscriber** inside `open_mower_ros` to `/xbot_positioning/xb_pose` (the ~48 Hz fused GPS/odometry pose, map frame) plus `/xbot_monitoring/robot_state` (telemetry), and pushes each sample to the browser, which **interpolates** the marker between frames every animation frame — so it glides instead of jumping every few seconds. On ROS 2 / non-xbot setups it transparently falls back to a `tf2_echo` / `tf_echo` probe (tries `map`/`odom` → `base_link`/`base_footprint`), and the client falls back to polling `GET /api/robot_pose` if SSE is unavailable. Marker style reflects **navigation**, **docking**, **charging at dock**, **dock full**, **emergency**, and **error** states, with RTK status. Streaming pauses while the browser tab is hidden.
- **Mower control** — a floating control bar on the map with **Start**, **Stop**, **Home**, and **Reset E-stop**, wired to OpenMower's real services (`/mower_service/high_level_control` for start/home/reset-emergency; `/ll/_service/emergency` for the immediate stop) via `POST /api/control`. **Start/Home/Reset need a two-step confirm** (click → *Confirm?* → click); **Stop** is one tap. ⚠️ These move a real robot with spinning blades — disable the feature entirely with `OPENMOWER_CONTROL_DISABLE=1`
- Optional **WiFi signal map**: records the mower radio's dBm value together with each live pose and paints a red-to-green heatmap over the map. Measurements are stored centrally on the mower, shared by every browser, quantized to 0.75 m cells, and capped at 2,000 points.
- Auto-load `/data/ros/map.json` (if present)
- Auto-fill projection from `/data/params/mower_params.yaml` (`datum_lat`, `datum_long`)
- Save directly to `/data/ros/map.json` with automatic timestamped backup
- Optional: restart the container named in `OPENMOWER_CONTAINER_NAME` via mounted Docker socket (Save + restart)

## Deploy via Dockge (OpenMower)

1. Open Dockge: [http://openmower:5001](http://openmower:5001)
2. Click **+ Compose**
3. Paste this into the `compose.yaml` field:

```yaml
services:
  openmower-map-editor:
    image: ghcr.io/revlaw/openmowermapeditor:latest
    container_name: openmower-map-editor
    restart: unless-stopped
    ports:
      - "5080:80"
    volumes:
      - type: bind
        source: /home/openmower/params
        target: /data/params
        read_only: true
      - type: bind
        source: /home/openmower/ros
        target: /data/ros
      - type: bind
        source: /var/run/docker.sock
        target: /var/run/docker.sock
    environment:
      OPENMOWER_CONTAINER_NAME: open_mower_ros
      # Optional tuning (see Environment variables below):
      # OPENMOWER_POSE_CONTAINER: open_mower_ros
      # OPENMOWER_POSE_CACHE_MS: "2200"
      # OPENMOWER_STREAM_FRESH_MS: "2000"
      # OPENMOWER_POSE_DISABLE: "0"
      # OPENMOWER_CONTROL_DISABLE: "0"   # set "1" to hide/disable Start/Stop/Home/Reset
      # OPENMOWER_TF_ECHO_TIMEOUT_SEC: "4"
      # OPENMOWER_ROS_TOPIC_TIMEOUT_SEC: "4"
      # OPENMOWER_ROS_TOPIC_FALLBACK_SEC: "10"
      # OPENMOWER_VERBOSE_LOGS: "0"
      # WIFI_MAP_CELL_SIZE_M: "0.75"
      # WIFI_MAP_MAX_POINTS: "2000"
      # WIFI_MAP_FLUSH_MS: "30000"
      # WIFI_MAP_COLLECTOR_INTERVAL_MS: "10000"
      # WIFI_MAP_COLLECTOR_CELL_REVISIT_MS: "300000"
      # WIFI_MAP_COLLECTOR_DISABLE: "0"
```

1. Click **Deploy**
2. Open the editor at [http://openmower:5080](http://openmower:5080)

## Usage

1. Open the app at [http://openmower:5080](http://openmower:5080).
2. On startup, the editor tries to:
  - load `/data/ros/map.json`
  - read `/data/params/mower_params.yaml` and apply `datum_lat` / `datum_long`
3. If no map is found, load one manually with the file picker.
4. Pick a zone from the **Selected zone** dropdown (colored type badge: 🟩 mow · 🟥 obstacle · 🟦 nav).
5. Create zones in the **Create zone** panel — pick a type, then **Add zone** (square at the map center) or draw a rectangle/circle. Use the **Selected zone** panel to pick, name, retype, reorder, or remove a zone, and the **Mowing** panel to set a mow zone's cutting parameters and preview the path.
6. Use the tool dock on the right to edit your map geometry.
7. Optional: turn on **Live robot** to stream the pose from the running ROS container (requires the Docker socket mount). The marker glides in real time from the fused map-frame pose; on fallback (probe) setups it matches the map when TF uses the `map` frame, and may drift relative to `map.json` while only `odom` is available until localization aligns. Status and mode lines update from ROS telemetry.
8. Optional: turn on **WiFi signal map** in the live robot panel to display the heatmap. The mower records the survey autonomously without an open browser and stores it in `/data/ros/wifi-signal-map.json`; every browser refreshes the shared view every 15 seconds. Use **Clear shared survey** to start a fresh measurement for all devices.
9. Save your edits:
  - **Save map.json** writes to `/data/ros/map.json` and creates a backup first (`map.json.bak-<timestamp>`).
  - **Save + restart ROS** does the same, then restarts the container set in `OPENMOWER_CONTAINER_NAME` through the mounted Docker socket.
  - If direct save is unavailable, fallback is downloading the map as `openmower-map-edited.json`.
10. Roll back from backup (if needed):
  - Click **Load map / backup…** to open the gallery of `map.json` (running) and `map.json.bak-*` versions from `/data/ros`.
  - Each version shows a **mini-map preview**, a friendly timestamp, summary stats (zones / points / mow area), and the **difference vs your current map** (Δ zones / points / area).
  - Click **Load this version** to load it (nothing is overwritten).
  - Click **Save map.json** (or **Save + restart ROS**) to make a loaded backup your active `map.json`.

## WiFi survey storage

The WiFi heatmap is shared mower-side state, not map geometry and not browser data. No active browser session is required:

- The editor backend starts one persistent, fixed-name `rospy` collector in the ROS container. It subscribes to the fused map-frame pose and emits only one compact pose/dBm sample every 10 seconds; it does not poll ROS status topics or spawn a process per sample.
- A newly visited cell is stored immediately. A known cell is sampled in memory but only recorded again after at least 5 minutes and a signal change of at least 3 dBm, avoiding repeated SD-card writes while the mower is stationary.
- Samples outside the current `map.json` bounds (plus a size-aware safety margin) are rejected, so an unlocalized start-up pose cannot pollute the heatmap.
- The backend merges readings into configurable spatial cells (`0.75 m` by default), keeps at most 2,000 cells, and evicts the oldest cell when the limit is reached. A full default survey is typically well below 200 KB.
- In-memory changes are written atomically to `/data/ros/wifi-signal-map.json` no more than once every 30 seconds. A graceful container stop forces the final pending write. Ownership and mode follow the mower map directory (`openmower:openmower`, mode `664` on a standard deployment).
- Clearing the survey first copies the current file to `/data/ros/wifi-signal-map.json.bak-clear`. The single backup is overwritten on the next clear, so this safety net has a fixed storage cost.
- Browsers refresh the shared survey every 15 seconds. Revision-aware requests return metadata without resending the point list when nothing changed.
- Existing survey points from the earlier browser-local implementation are imported once and then removed from `localStorage`. Only the user's on/off preference remains browser-local. If the autonomous collector is explicitly disabled, an open browser with live pose can still record as a fallback.

### Vanilla OpenMower compatibility

The autonomous collector does not depend on `rpi-monitor`, `jq`, the Docker CLI, host Python, or any other package installed directly on the Raspberry Pi. It talks to Docker through the mounted Engine socket and runs its small subscriber inside the official `open_mower_ros` container, where ROS, Bash, Python 3, and the standard command-line utilities already exist.

The standard OpenMower OS v2 setup is sufficient: `open_mower_ros` must use host networking so `/proc/net/wireless` reflects the mower's WiFi interface, and the map editor needs the Docker socket plus the `/home/openmower/ros` bind mount shown above. Missing fused pose, map bounds, WiFi data, or in-container commands are reported in `storage.collector.lastError`; the editor and normal map operations continue working if collection is unavailable.

Resource use is bounded: one sleeping ROS subscriber remains active and emits at the configured interval (10 seconds by default), memory is capped at 2,000 grid cells, and disk writes are coalesced to at most one every 30 seconds. Restarting the editor replaces the fixed-name collector instead of accumulating processes. No survey data or SSID is uploaded to GitHub or any external service.

API endpoints:

- `GET /api/wifi-map?revision=<n>` returns the shared points, limits, file size, and revision. If `<n>` is current, the response contains `notModified: true` and omits the points.
- `POST /api/wifi-map/samples` validates and merges one or more `{ x, y, signalDbm }` readings; the backend assigns the timestamp.
- `DELETE /api/wifi-map` backs up and then clears the shared survey for every connected device, flushing the empty state immediately.

## Tool Legend

Tools live in the floating dock on the right (icons from [Material Symbols Outlined](https://fonts.google.com/icons)). Every action is also reachable from the **command palette** (`Ctrl`/`Cmd + K`); press `?` for the full shortcut cheat sheet.

- **near_me** — select / drag (`V`): default mode, drag a vertex or click to select. Arrow keys nudge the selection (`Shift` = larger step).
- **add_location_alt** — add point (`A`): click near an outline and the vertex is inserted on the **nearest edge**.
- **blur_circular** — push brush (`B`): drag across the outline to push points along your stroke; radius/strength sliders appear in the sidebar.
- **horizontal_rule** — snap line (`S`): pick start and end point.
- **select_all** — multi-select (`M`): click points or `Shift + drag` a rectangle, then drag the group handle.
- **open_with** — move whole zone (`G`): drag the centroid handle to translate the entire zone.
- **delete** — remove selected point(s) (`Del`): deletes the whole multi-selection when several points are selected.
- **undo** / **redo** — history (`Ctrl + Z` / `Ctrl + Shift + Z`).

Create & transform (sidebar **Create** and **Transform zone** panels, also in the command palette):

- **Rectangle** (`R`) / **Circle** (`O`) — drag on the map to draw a new zone of the chosen type.
- **Place dock** — click the map to set the docking station (`docking_stations[0]`).
- **Duplicate zone** (`Ctrl + D`) — copy the selected zone, offset so the copy is visible.
- **Rotate** ±15° / **Scale** ±5% — transform the selected zone about its centroid.
- **Grow / Shrink** — offset every border of the selected zone outward/inward by a margin (a buffer; unlike Scale it keeps a uniform border distance). For a donut (mow + obstacle), **Grow** the mow and **Shrink** the obstacle to widen the mowable ring.
- **Simplify outline** — Douglas–Peucker reduction with an adjustable tolerance, to thin out dense outlines.
- **Create zone** panel adds a zone (square at center, or rectangle/circle draw); the **Selected zone** panel names / retypes / reorders / removes the current zone.
- **Live robot** (toolbar toggle) streams the fused ROS pose via the mounted Docker socket (SSE) and interpolates the marker for smooth motion + heading. While driving/mowing it shows a **top-down mower** icon rotated to the live heading; other states swap the icon (docking, dock charging, dock full, emergency, error) and keep the badge fixed. Preference is stored in `localStorage`. The dock uses **ev_station** on the map.
- `Load map / backup…` opens a gallery of saved versions, each with a mini-map preview, timestamp, stats, and a diff vs your current map.
- **Zoom** buttons sit at the bottom-right; the **Layers** button (bottom-left) switches the base map.

Tool sliders are contextual:

- Brush sliders appear only while brush mode is active.
- Mowing parameters (**Mowing** panel) and transform controls (**Transform zone** panel) live in the sidebar.
- On touch devices, brush also supports finger paint (`touchstart/move/end`).
- Light/dark mode affects sidebar/tool styling only. Map line/point colors remain identical in both modes.

## Development

Requirements: Node **20.19+** (Vite 8 / Vitest 4 floor); Node 22 LTS recommended.

Stack (kept current):

- Svelte **5**, Vite **8**, `@sveltejs/vite-plugin-svelte` **7**
- Tailwind CSS **4** (`@tailwindcss/postcss`), PostCSS **8**
- Vitest **4** (+ happy-dom for the component mount smoke test)
- Express **5**, js-yaml **5**, Leaflet **1.9**

```bash
npm install

# Run the Express backend with local (non-container) data paths:
PORT=5080 MAP_PATH=./ros/map.json PARAMS_PATH=./params/mower_params.yaml node server.js

# In another terminal, start Vite with HMR (proxies /api -> :5080):
npm run dev          # http://localhost:5173

npm test             # vitest unit tests (geometry, projection, tools, validation)
npm run build        # compile the Svelte app into dist/
npm start            # serve the built dist/ via Express (production entry)
```

Project layout:

- `src/lib/` — framework-free, unit-tested logic: `geo/` (projection, geometry, offset/simplify, coverage, brush/snap tools), `format/` (map.json + outline/shape helpers), `validation.js`, `measurements.js`, `summary.js`, `api.js`, and Svelte `stores/`.
- `src/map/` — the Leaflet controller (rendering + interactions).
- `src/components/` — Svelte UI (shell, sidebar panels, tool dock, robot HUD, command palette).
- `server.js` — serves the built `dist/` and implements map, robot-pose, restart, backup, and WiFi-survey APIs. Paths are configurable for local development.

`POST /api/map`, `GET /api/map`, `/api/map/backups`, `/api/params`, `/api/robot_pose`, `/api/robot_pose/stream` (SSE), `/api/mow_params`, `POST /api/plan_path`, `POST /api/control`, and `/api/wifi-map` are the stable backend contract; the map.json on-disk format is unchanged.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENMOWER_CONTAINER_NAME` | `open_mower_ros` | Container restarted by **Save + restart ROS** |
| `OPENMOWER_POSE_CONTAINER` | same as above | Container used for TF echo / ROS topic sampling |
| `OPENMOWER_POSE_DISABLE` | `0` | Set `1` to disable live pose entirely |
| `OPENMOWER_CONTROL_DISABLE` | `0` | Set `1` to disable the Start/Stop/Home/Reset mower control buttons |
| `OPENMOWER_POSE_CACHE_MS` | `2200` | Server-side cache for the pose fallback probe (ms) |
| `OPENMOWER_STREAM_FRESH_MS` | `2000` | How long a streamed pose sample stays "fresh" before the SSE endpoint falls back to the probe (ms) |
| `OPENMOWER_TF_ECHO_TIMEOUT_SEC` | `4` | Timeout for `tf_echo` / `tf2_echo` inside the container |
| `OPENMOWER_ROS_TOPIC_TIMEOUT_SEC` | `4` | Timeout for `rostopic` / `ros2 topic echo` samples |
| `OPENMOWER_ROS_TOPIC_FALLBACK_SEC` | `10` | Longer timeout when sampling `/mower_logic/current_state` fallback |
| `OPENMOWER_VERBOSE_LOGS` | off | Set `1` to log every HTTP request, Docker API call, and routine file reads |
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Override if your host uses a non-default Docker socket |
| `PORT` | `80` | HTTP listen port inside the container (compose maps `5080:80`) |
| `MAP_PATH` | `/data/ros/map.json` | Map file path (override for local dev) |
| `PARAMS_PATH` | `/data/params/mower_params.yaml` | Params file path (override for local dev) |
| `WIFI_MAP_PATH` | `/data/ros/wifi-signal-map.json` | Shared WiFi survey file |
| `WIFI_MAP_CELL_SIZE_M` | `0.75` | Spatial cell size used to merge nearby readings |
| `WIFI_MAP_MAX_POINTS` | `2000` | Hard upper bound for stored survey cells |
| `WIFI_MAP_FLUSH_MS` | `30000` | Minimum delay between atomic disk writes |
| `WIFI_MAP_COLLECTOR_INTERVAL_MS` | `10000` | Delay between autonomous WiFi samples (minimum 5 seconds) |
| `WIFI_MAP_COLLECTOR_CELL_REVISIT_MS` | `300000` | Minimum age before a known cell may be recorded again |
| `WIFI_MAP_COLLECTOR_DISABLE` | `0` | Set `1` to disable autonomous collection and use browser fallback |

Inside the container the defaults match the bind mounts (`/data/ros`, `/data/params`); for local development point `MAP_PATH` / `PARAMS_PATH` at files in the repo.

## Security

Mounting **`/var/run/docker.sock`** gives the editor API the same ability to control Docker as root on the host. Only deploy on a **trusted network** (for example your home LAN), do not expose port `5080` to the public internet without an additional access layer, and treat saved map data as sensitive to your property layout.

## Privacy / GitHub Safety

The included `.gitignore` excludes local/private artifacts such as:

- `map.json` and `*.local.json`
- Cursor local folders (`.cursor/`, `terminals/`, `agent-transcripts/`, `mcps/`)
- common IDE/log/temp files

This repository should not contain real mower coordinates, passwords, or API keys.

## Notes

- OpenMower uses local meter coordinates (`x`, `y`), so map projection is an approximation from your configured datum.
- Aerial imagery coverage and zoom depth vary by provider and region. Esri World Imagery is global but lacks deep zoom in many rural areas (it returns blank tiles past where data exists) — switch to OpenStreetMap or a custom regional source via the **Layers** control there.
- Zone names are stored under `properties.name` (editor convenience metadata). OpenMower's firmware selects zones by order/index, not by name, so naming doesn't change robot behavior.
- Smooth live pose runs a **persistent `rospy` subscriber** (`/xbot_positioning/xb_pose` + `/xbot_monitoring/robot_state`) inside the ROS container via a **long-lived streamed `docker exec`**, so there's no per-poll exec overhead; samples are pushed to the browser over **SSE** and interpolated client-side. When `xbot_msgs` isn't present (ROS 2 / other setups) the server falls back to **`ros2 run tf2_ros tf2_echo`** / **`rosrun tf tf_echo`** and topic sampling (`rostopic echo` before `ros2 topic echo`), parsed with **stdlib-only `python3`**. If no pose is published yet, the HUD shows the probe error.
- The **exact mowing path** calls `/slic3r_coverage_planner/plan_path` inside the ROS container (via a one-shot `rospy` `docker exec`), replicating `MowingBehavior.cpp`'s request exactly (angle incl. global `mow_angle_offset`, `outline_count`/`overlap`/`offset`, `tool_width` spacing, obstacles as holes, linear fill). It plans only — it never commands motion — and results are cached briefly per request.
- WiFi signal is read from `/proc/net/wireless` by a persistent, fixed-name `rospy` collector inside the ROS container, which must share the host network namespace. The compact survey is stored separately from `map.json`, written atomically at most once per flush interval, owned like the mower map files, and never sent to GitHub.
- Always validate edited borders before deploying to a mower in production.
