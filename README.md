# OpenMower Map Editor

Browser-based map editor for OpenMower JSON maps, deployed via Dockge on OpenMower.

> **Vibecoded notice:** this project is **purely vibecoded**.

![OpenMower Map Editor Screenshot](./screenshot1.jpg)

## Features

- Edit OpenMower `areas[].outline[]` points directly on a satellite map
- Drag single points directly (click and drag without selecting a separate handle first)
- Add and remove points
- Add and remove full zones (`mow`, `obstacle`, `nav`)
- Push nearby points outward with a brush click/drag tool and live radius preview
- Lock closed-loop endpoints (first/last point stay synchronized)
- Snap a selected index range to a straight, equally spaced line
- Multi-select points and move them together
- Box select in multi-select mode (`Shift + drag`)
- Cleanup near-duplicate points with a meter threshold
- Move the home station marker (`docking_stations[0].position`)
- Undo/redo history for editing actions (arrow buttons)
- Type-aware overlays while editing:
  - editing `mow`: shows `obstacle` (red dashed) and `nav` (blue dashed)
  - editing `obstacle`: shows `mow` (white dashed) and `nav` (blue dashed)
  - editing `nav`: shows `mow` (white dashed) and `obstacle` (red dashed)
- Stable map readability: map colors stay fixed; light/dark toggle changes sidebar UI only
- Optional **live robot** overlay: **Live robot** toolbar button polls `GET /api/robot_pose`, which runs **`tf2_echo` / `tf_echo`** in the ROS container (Docker socket) and parses output with stdlib-only Python (tries `map`/`odom` → `base_link`/`base_footprint`). Marker style reflects **navigation**, **docking**, **charging at dock**, **dock full**, **emergency**, and **error** states (from sampled ROS topics when available). Polling pauses while the browser tab is hidden.
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
      # OPENMOWER_POSE_DISABLE: "0"
      # OPENMOWER_TF_ECHO_TIMEOUT_SEC: "4"
      # OPENMOWER_ROS_TOPIC_TIMEOUT_SEC: "4"
      # OPENMOWER_ROS_TOPIC_FALLBACK_SEC: "10"
      # OPENMOWER_VERBOSE_LOGS: "0"
```

1. Click **Deploy**
2. Open the editor at [http://openmower:5080](http://openmower:5080)

## Usage

1. Open the app at [http://openmower:5080](http://openmower:5080).
2. On startup, the editor tries to:
  - load `/data/ros/map.json`
  - read `/data/params/mower_params.yaml` and apply `datum_lat` / `datum_long`
3. If no map is found, load one manually with the file picker.
4. Pick an area in the area selector.
5. To manage full zones, choose a type in **New zone type** and use **Add zone** / **Remove zone**.
6. Use the tool buttons below the area selector to edit your map geometry.
7. Optional: turn on **Live robot** to poll pose from the running ROS container (requires the Docker socket mount). Position matches the map when TF uses the `map` frame; if only `odom` is available, the marker may drift relative to `map.json` until localization aligns. Status and mode lines update from ROS when topics respond in time.
8. Save your edits:
  - **Save map.json** writes to `/data/ros/map.json` and creates a backup first (`map.json.bak-<timestamp>`).
  - **Save + restart ROS** does the same, then restarts the container set in `OPENMOWER_CONTAINER_NAME` through the mounted Docker socket.
  - If direct save is unavailable, fallback is downloading the map as `openmower-map-edited.json`.
9. Roll back from backup (if needed):
  - Use the **Load map/backup** dropdown (under file upload) to pick either `map.json` (running) or a `map.json.bak-`* file from `/data/ros`.
  - The selected entry is loaded immediately.
  - Click **Save map.json** (or **Save + restart ROS**) to make a loaded backup your active `map.json`.

## Tool Legend

Toolbar uses [Material Symbols Outlined](https://fonts.google.com/icons) (loaded from Google Fonts).

- **undo** / **redo** — history.
- **select_all** — multi-select (click points or `Shift + drag` rectangle, then drag group handle).
- **add** — add point (click map to insert).
- **blur_circular** — push brush (click or hold-and-drag).
- **horizontal_rule** — snap line (pick start and end point).
- **cleaning_services** — cleanup (first click enables slider, second click applies).
- **delete** — remove selected point.
- `Add zone` / `Remove zone` create or delete the currently selected `mow` / `obstacle` / `nav` area.
- **Live robot** (toolbar toggle) polls ROS TF via the mounted Docker socket and shows heading; marker color/icon follows **visual mode** (nav, docking, dock charging, dock full, emergency, error). Preference is stored in `localStorage`. The dock uses **ev_station** on the map.
- `Load map/backup` dropdown loads `map.json` or a backup file directly on selection.

Tool sliders are contextual:

- Brush sliders appear only while brush mode is active.
- Cleanup slider appears only while cleanup mode is active.
- On touch devices, brush also supports finger paint (`touchstart/move/end`).
- Light/dark mode affects sidebar/tool styling only. Map line/point colors remain identical in both modes.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENMOWER_CONTAINER_NAME` | `open_mower_ros` | Container restarted by **Save + restart ROS** |
| `OPENMOWER_POSE_CONTAINER` | same as above | Container used for TF echo / ROS topic sampling |
| `OPENMOWER_POSE_DISABLE` | `0` | Set `1` to disable live pose entirely |
| `OPENMOWER_POSE_CACHE_MS` | `2200` | Server-side cache for pose probe (ms) |
| `OPENMOWER_TF_ECHO_TIMEOUT_SEC` | `4` | Timeout for `tf_echo` / `tf2_echo` inside the container |
| `OPENMOWER_ROS_TOPIC_TIMEOUT_SEC` | `4` | Timeout for `rostopic` / `ros2 topic echo` samples |
| `OPENMOWER_ROS_TOPIC_FALLBACK_SEC` | `10` | Longer timeout when sampling `/mower_logic/current_state` fallback |
| `OPENMOWER_VERBOSE_LOGS` | off | Set `1` to log every HTTP request, Docker API call, and routine file reads |
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Override if your host uses a non-default Docker socket |
| `PORT` | `80` | HTTP listen port inside the container (compose maps `5080:80`) |

Paths for map and params inside the container are fixed (`/data/ros`, `/data/params`); only the host bind mounts change.

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
- Live pose runs **`ros2 run tf2_ros tf2_echo`** or **`rosrun tf tf_echo`** inside the ROS container (after sourcing ROS setup scripts, including `/opt/open_mower_ros/devel/setup.bash` when present). Topic sampling prefers **`rostopic echo`** on ROS 1 before trying `ros2 topic echo`. Output is parsed with **stdlib-only `python3`**. If TF is not published yet, the HUD shows the probe error.
- Always validate edited borders before deploying to a mower in production.