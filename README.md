# OpenMower Map Editor

Dark-mode, browser-based map editor for OpenMower JSON maps, deployed via Dockge on OpenMower.

> **Vibecoded notice:** this project is **purely vibecoded**.

![OpenMower Map Editor Screenshot](./screenshot1.jpg)

## Features

- Edit OpenMower `areas[].outline[]` points directly on a satellite map
- Drag single points to reposition borders precisely
- Add and remove points
- Lock closed-loop endpoints (first/last point stay synchronized)
- Snap a selected index range to a straight, equally spaced line
- Multi-select points and move them together
- Box select in multi-select mode (`Shift + drag`)
- Cleanup near-duplicate points with a meter threshold
- Move the home station marker (`docking_stations[0].position`)
- Undo/redo history for editing actions
- Auto-load `/data/ros/map.json` (if present)
- Auto-fill projection from `/data/params/mower_params.yaml` (`datum_lat`, `datum_long`)
- Save directly to `/data/ros/map.json` with automatic timestamped backup

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
```

4. Click **Deploy**
5. Open the editor at [http://openmower:5080](http://openmower:5080)

## Usage

1. Open the app at [http://openmower:5080](http://openmower:5080).
2. On startup, the editor tries to:
   - load `/data/ros/map.json`
   - read `/data/params/mower_params.yaml` and apply `datum_lat` / `datum_long`
3. If no map is found, load one manually with the file picker.
4. Pick an area in the area selector.
5. Edit points using:
   - **Single edit:** click point, drag marker
   - **Add mode:** insert new points on click
   - **Snap line:** click start + end points
   - **Multi-select:** click points or `Shift + drag` rectangle, then drag group handle
   - **Cleanup:** remove very close points with threshold
6. Click **Save map.json** to write back to `/data/ros/map.json`.
   - A backup file is created automatically before overwrite (`map.json.bak-<timestamp>`).
   - If direct save is unavailable, fallback is downloading the map as `openmower-map-edited.json`.

## Privacy / GitHub Safety

The included `.gitignore` excludes local/private artifacts such as:

- `map.json` and `*.local.json`
- Cursor local folders (`.cursor/`, `terminals/`, `agent-transcripts/`, `mcps/`)
- common IDE/log/temp files

## Notes

- OpenMower uses local meter coordinates (`x`, `y`), so map projection is an approximation from your configured datum.
- Always validate edited borders before deploying to a mower in production.
