# OpenMower Map Editor (Docker)

Simple web editor for OpenMower map JSON files with:

- Select point
- Move point (drag)
- Add point
- Remove point
- Cleanup near-duplicate points
- Undo / redo
- Download updated JSON

The editor overlays points on a satellite map and converts OpenMower local `x/y` meters to lat/lng using a configurable origin.

## Run with Docker

```bash
docker build -t openmower-map-editor .
docker run --rm -p 8080:80 openmower-map-editor
```

Open: [http://localhost:8080](http://localhost:8080)

## How to use

1. Open the page.
2. Either load your map JSON with the file picker, or place `map.json` in this folder for auto-load.
3. Set **Origin latitude/longitude** to your map location and click **Apply projection**.
4. Select an area.
5. Click a point to select it, then drag the red marker to move it.
6. Toggle **Add point** to insert new points by clicking on the map.
7. Use **Remove selected** to delete the selected point.
8. Optionally run **Cleanup close points** with a meter threshold to remove near-duplicate points.
9. Click **Download JSON** to save changes.

## Notes

- OpenMower stores local coordinates in meters. Real-world overlay is approximate and depends on the origin you set.
- If your `x/y` axis orientation differs, adjust origin and validate visually before using in production.
- `.gitignore` excludes local Cursor artifacts and `map.json` so private property data is not accidentally committed.
