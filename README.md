# OpenMower Map Editor

> [!WARNING]
> **Vibe-coded.** Most of this project was written with an AI coding assistant and tested by one hobbyist on one mower. It talks to a **real robot with a blade**: expect bugs, keep the robot in sight, keep your hand near **STOP**, and read the code before you trust it with anything that matters. Use at your own risk.

Edit the zones of your [OpenMower](https://github.com/ClemensElflein/open_mower_ros) robot on a satellite map, right in the browser — on your computer or your phone. The editor runs on the mower's own Raspberry Pi next to OpenMower.

![Desktop: zone list with the inline zone editor, mowing coverage preview on the selected lawn, tool dock and robot status](docs/screenshots/desktop.jpeg)

<p align="center">
  <img src="docs/screenshots/mobile-view.jpeg" alt="Phone view mode: the live robot mid-mow, with the area it has already mowed" width="260">
  &nbsp;&nbsp;
  <img src="docs/screenshots/mobile-drive.jpeg" alt="Phone: driving the mower with the on-screen joystick" width="260">
</p>
<p align="center"><sub>Screenshots use a demo map in a public park.</sub></p>

## What it does

- **Edit zones** — drag points, draw new zones, split, merge, simplify; snapping to neighbouring zones; undo / redo.
- **Preview mowing** — see the rows the robot will drive, or the exact path from OpenMower's own planner.
- **Watch the robot live** — its position, state, battery, RTK and sensors (temperatures, voltages, motor).
- **Drive it from your phone** — a joystick with a sprint button, **Go to** (tap the map, the robot drives there around obstacles) and **Record** (drive around an area to make it a zone).
- **Look back** — the robot's movement trail per day and a WiFi signal map of your garden.
- **Stay safe with your map** — every save makes a backup first and shows what changed; unsaved edits survive a reload.

## Install

You need **OpenMower OS v2** (with Docker and Dockge).

1. Open Dockge at [http://openmower:5001](http://openmower:5001) and click **+ Compose**.
2. Paste this and click **Deploy**:

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
         # OPENMOWER_CONTROL_DISABLE: "1"   # turn off all robot control (view and edit only)
   ```

3. Open [http://openmower:5080](http://openmower:5080).

**Update:** in Dockge open the stack, click **Pull**, then **Recreate**. Your map, backups and recorded data stay in `/home/openmower/ros`.

## First steps

1. **Look around.** The map opens with your zones. On a phone you start in a calm view mode — tap **Edit** for the tools.
2. **Change a zone.** Tap a zone, then drag its points. Mistakes? Undo with the arrow buttons (or `Ctrl + Z`).
3. **Save.** The save dialog shows what changed. Tick **Restart ROS** so the robot loads the new map right away.
4. **Drive the robot** (optional). In the **Robot** tab tap **Start drive mode**: a joystick, **Go to** and **Record** appear. The blade stays off while driving.

Something went wrong? **Map → File → Backups…** lets you load an older version and save it again.

## Safety

- The editor can **move the robot**. Keep it in sight while driving, and use **STOP** (top right) as an emergency stop. To use the editor without any control, set `OPENMOWER_CONTROL_DISABLE: "1"`.
- It has full access to Docker on the mower (it needs that to talk to OpenMower). Only run it on a **trusted home network**; never expose port `5080` to the internet.
- Your map shows your property — treat it as private.

## Learn more

- [docs/reference.md](docs/reference.md) — every feature, all controls and shortcuts, settings (environment variables), how it talks to OpenMower.
- [CHANGELOG.md](CHANGELOG.md) — what changed in each version.
- [AGENTS.md](AGENTS.md) — a guided tour of the code, for contributors.

## Development

Node **22.12+** is needed.

```bash
npm install
PORT=5080 MAP_PATH=./ros/map.json PARAMS_PATH=./params/mower_params.yaml node server.js   # backend
npm run dev    # frontend with hot reload on http://localhost:5173 (second terminal)
npm test       # tests
```

Built with Svelte 5, Vite 8, Tailwind CSS 4 and a small Express 5 backend.
