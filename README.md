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
- Save the edited map directly back to the mower via `Save to mower`
- Automatic timestamped backup before each direct save
- Download updated JSON

## Deploy via Dockge (OpenMower)

```bash
docker build -t openmower-map-editor .
docker run --rm -p 8080:8090 openmower-map-editor
```

4. Click **Deploy**
5. Open the editor at [http://openmower:5080](http://openmower:5080)

## Direct Save To A Mower

Mount your OpenMower ROS directory into the container to enable the `Save to mower` button:

```bash
docker run --rm -p 8080:8090 -v /home/openmower/ros:/data/ros openmower-map-editor
```

The app will:

- read `/data/ros/map.json`
- create a backup like `/data/ros/map.json.bak.YYYYMMDD-HHMMSS`
- atomically replace `map.json` after a successful save

If no writable map directory is mounted, you can still use `Download JSON` as before.

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
5. Either save directly with **Save to mower** or export with **Download JSON**.

## Privacy / GitHub Safety

The included `.gitignore` excludes local/private artifacts such as:

- `map.json` and `*.local.json`
- backup files such as `*.bak.*`
- mounted runtime data in `/data/`
- Cursor local folders (`.cursor/`, `terminals/`, `agent-transcripts/`, `mcps/`)
- common IDE/log/temp files

## Notes

- OpenMower uses local meter coordinates (`x`, `y`), so map projection is an approximation from your configured datum.
- Always validate edited borders before deploying to a mower in production.
- OpenMower services may need a restart after saving a changed `map.json`, depending on your setup.
