# OpenMower Map Editor

Dark-mode, browser-based map editor for OpenMower JSON maps, packaged in Docker.

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
- Download updated JSON

## Quick Start (Docker)

```bash
docker build -t openmower-map-editor .
docker run --rm -p 8080:80 openmower-map-editor
```

Open [http://localhost:8080](http://localhost:8080)

## Usage

1. Load your map JSON with the file picker (or place `map.json` in this folder for auto-load).
2. Set origin coordinates from OpenMower:
   - run `openmower config ros`
   - use `datum_lat` and `datum_long`
3. Pick an area in the area selector.
4. Edit points using:
   - **Single edit:** click point, drag marker
   - **Add mode:** insert new points on click
   - **Snap line:** click start + end points
   - **Multi-select:** click points or `Shift + drag` rectangle, then drag group handle
   - **Cleanup:** remove very close points with threshold
5. Download the edited JSON.

## Privacy / GitHub Safety

The included `.gitignore` excludes local/private artifacts such as:

- `map.json` and `*.local.json`
- Cursor local folders (`.cursor/`, `terminals/`, `agent-transcripts/`, `mcps/`)
- common IDE/log/temp files

## Notes

- OpenMower uses local meter coordinates (`x`, `y`), so map projection is an approximation from your configured datum.
- Always validate edited borders before deploying to a mower in production.
