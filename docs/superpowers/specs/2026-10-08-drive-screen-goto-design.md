# Fullscreen drive screen & go-to-position — design

Turn **Start drive mode** into a fullscreen drive screen — map following the
robot, on-screen joystick, a **Record** control that turns the driven path into
a zone, and **Go to**: tap the map and the robot drives itself there along a
route that avoids obstacle zones.

## Goal & scope

- One screen, usable on a phone in the garden, to drive the mower, send it to a
  spot, and record zones — without the sidebar or editing tools in the way.
- Go-to routes **around obstacle zones** and stays inside the drivable area
  (mow + nav zones), with a clearance margin.
- Every existing drive-mode safeguard keeps applying (blade off, deadman, speed
  caps, stop on blur / hidden tab, `OPENMOWER_CONTROL_DISABLE`).
- **No backend changes.**

Out of scope: go-to outside drive mode; go-to while the robot mows or docks;
using OpenMower's own planner; driving with the browser closed; routing around
anything not drawn as a zone (live obstacles, people, pets).

## Constraints (verified on the mower, `open_mower_ros:edge`, 2026-07-21)

`twist_mux` priorities on the robot:

| Input | Topic | Priority | Publisher |
| --- | --- | --- | --- |
| navigation | `nav_vel` | 10 | `move_base_flex` (GlobalPlanner + FTCPlanner) |
| logic | `logic_vel` | 50 | `mower_logic` |
| override | `override_vel` | 100 | — |

- In **IDLE**, `IdleBehavior` calls `stopMoving()` at 25 Hz → zero on
  `logic_vel` overrides `nav_vel`; external `move_base_flex` goals never move
  the robot.
- In **AREA_RECORDING** (drive mode), `mower_logic` republishes `/joy_vel` onto
  `logic_vel` (`redirect_joystick()`), and after 10 s without joystick input
  publishes zero there every 0.5 s → `nav_vel` is blocked here too.
- `move_base_flex` only gets the wheels inside `mower_logic`'s own Mowing /
  Docking behaviours, where an outside goal would preempt the mowing goal.

Therefore go-to is **automated joystick input**: the browser computes velocity
commands from the live pose and sends them through the existing
`POST /api/teleop/drive` → persistent helper → `/joy_vel`, in drive mode only.
Live pose (`/xbot_positioning/xb_pose`) streams at ~48 Hz; the browser's
`robotPose` payload carries `x, y, yaw`, `positionAccuracy` (metres, `null` from
the fallback probe) and `source` (`"stream"` for the live subscriber). It has no
timestamp, so go-to stamps each pose on arrival.

## Architecture

```
tap on map ─▶ goto store ─▶ planRoute(map, start, target)        src/lib/geo/route.js
                 │                 └─▶ { ok, waypoints, length } | { ok:false, reason }
                 │  Go
                 ▼
        10 Hz loop: followStep(pose, waypoints, index)          src/lib/robot/follow.js
                 │        └─▶ { lx, az, index, done }
                 ▼
        sendTeleop(lx, az)  (existing)  ─▶ /api/teleop/drive ─▶ /joy_vel
```

Pure logic (`route.js`, `follow.js`) has no Svelte / Leaflet / DOM imports;
state and timing live in a store (`goto.js`); rendering in `mapController.js`
and `DriveView.svelte`.

## Route planner — `src/lib/geo/route.js`

`planRoute(areas, start, target, { clearance = 0.35, getType })` →
`{ ok: true, waypoints: [{x,y}...], length }` (waypoints exclude `start`,
end at `target`) or `{ ok: false, reason }` with `reason` one of
`"no-drivable-area" | "start-outside" | "target-outside" | "target-blocked" |
"no-route"`.

1. **Drivable region** — union of all `mow` and `nav` zone outlines with
   `polygon-clipping` directly (keeping holes; *not* via `geo/boolean.js`, which
   drops holes for `map.json`). Unioning first means two touching zones form
   one region with no gap at their shared border. Then subtract every
   `obstacle` zone. Result: a multipolygon whose rings (outer + holes) are the
   **boundary**.
2. **Clearance** — a point is *free* if it lies inside the region and is at
   least `clearance` from every boundary edge. A segment is *free* if it
   crosses no boundary edge and its distance to every boundary edge is at
   least `clearance` (segment–segment distance; bounding-box prefilter).
3. **Endpoints** — `target` must be free, otherwise `target-outside` (not in
   the region) or `target-blocked` (in an obstacle or within `clearance` of the
   boundary). `start` (the robot) only has to be inside the region, so a robot
   standing close to an edge can still leave; its first segment is checked
   only against edges farther than `clearance` from `start`.
   Outside the region → `start-outside`.
4. **Graph nodes** — each boundary ring is simplified (≈ 0.1 m, existing
   `simplify`) and offset into free space by `clearance × 1.1` (existing
   `offsetPolygon`, where positive = inward: `+` for outer rings, `−` for
   holes); offset vertices that are free become nodes. Plus `start` and
   `target`. `offsetPolygon` uses miter joins, so sharp corners can throw a
   vertex far out — harmless, because every node and edge is validated by the
   free-point / free-segment tests, never trusted from the offset.
5. **Search** — A* (Euclidean heuristic) over the visibility graph, evaluating
   edges lazily (free-segment test only when an edge is expanded). The direct
   `start → target` segment is tried first, so the common unobstructed case is
   a single waypoint.
6. **Output** — the waypoint list and total length.

**Which zones count:** all zones, including ones hidden or locked in the
editor (they exist on the robot). It uses the editor's *current* map; if it
has unsaved changes, the drive screen shows "Route uses unsaved map edits".

Budget: a typical garden map (≤ 20 zones, a few hundred vertices) plans in
under ~50 ms; planning runs once per tap, never per frame.

## Route follower — `src/lib/robot/follow.js`

`followStep(pose, waypoints, index, opts)` → `{ lx, az, index, done }`.

- Steers at `waypoints[index]`. Heading error = wrapped angle between `pose.yaw`
  and the bearing to the waypoint.
- **|error| > 35°** → turn on the spot (`lx = 0`, `az = k·error`, clamped) so the
  robot doesn't swing wide past an obstacle corner.
- Otherwise drive forward: `lx = maxSpeed · cos(error)`, scaled down within the
  last 1 m of the route and by turn sharpness; `az = k·error`.
- A waypoint within **0.25 m** counts as reached → `index + 1`; reaching the last
  one returns `done: true` with `lx = az = 0`.
- Caps: `maxSpeed` = go-to speed (default 0.3 m/s, never above the existing
  `MAX_LINEAR` 0.5 m/s); `|az| ≤ MAX_ANGULAR` (1.5 rad/s), reused from
  `robot/teleop.js`.

`offRouteDistance(pose, waypoints, index, start)` → distance from the pose to
the segment currently being driven (previous waypoint, or the route start, to
`waypoints[index]`).

## Go-to state — `src/lib/stores/goto.js`

`goto` store: `{ phase, target, waypoints, index, length, remaining, reason }`
with `phase` one of `idle | picking | planned | driving | arrived | stopped`.

- `armGoto()` → `picking` (next map tap is the target). `cancelGoto()` → `idle`.
- `pickTarget({x,y})` → runs `planRoute` from the current pose → `planned`
  (route shown, waiting for Go) or back to `picking` with `reason` shown.
- `startGoto()` (only when `planned`) → `driving`: a 100 ms interval calls
  `followStep` with the latest pose and sends the result via the existing
  `sendTeleop()`; `remaining` is updated each tick.
- Arrival → explicit zero command, `arrived` (toast "Arrived").
- **Preconditions** for `pickTarget` and `startGoto`: `driveMode === "on"`,
  `robotInRecordingMode`, a live pose with `source === "stream"` (the ~1 Hz
  fallback probe is too slow to steer by), `positionAccuracy` non-null and
  ≤ 0.2 m.
- **Auto-stop** → explicit zero command (as `releaseStick()`), `stopped` with a
  reason shown to the user:
  - Stop button (the existing emergency stop) or the drive screen's Stop;
  - joystick touched (`setStick` with a non-zero vector) — the joystick always
    wins;
  - no new pose for 1 s (arrival stamp), pose source no longer `"stream"`, or
    `positionAccuracy` missing / worse than 0.2 m;
  - more than 0.5 m off the current route segment;
  - window blur / tab hidden / pagehide (hooked into `initTeleopSafety`);
  - drive mode left or robot no longer in `AREA_RECORDING`;
  - `sendTeleop` rejected (`ok: false`) or unreachable.
- The server-side deadman (0.4 s) and speed clamp remain the last line of
  defence if the browser dies.

`teleop.js` gains one hook: `setStick` cancels an active go-to before
driving, and go-to's loop and the stick loop never run at the same time.

## Drive screen — `src/components/DriveView.svelte`

`driveView` flag in `stores/ui.js`.

**Entering / leaving**
- **Start drive mode** (Robot tab, command palette) → `enterDriveMode()` and
  `driveView = true`; requests the Fullscreen API on `document.documentElement`
  where supported (Android Chrome, desktop), else a full-viewport layout (iOS).
- While open: sidebar, rail, tool dock, selection bar and tool hint are hidden;
  `editMode` is off for the duration; `followRobot` is turned on (panning turns
  it off as today; the follow button stays available).
- **Exit** (top right) → stops go-to and the stick, `exitDriveMode()`
  (`record_exit`), closes the screen, leaves browser fullscreen. If a recording
  is active it asks first: **Finish & create zone / Discard / Stay**.
- Leaving browser fullscreen (Esc / back gesture) keeps the drive screen open
  in its full-viewport layout; it does not leave drive mode.
- **Sidebar panels**: `DrivePanel` keeps its intro, safety note and **Start
  drive mode**; its inline joystick is replaced by **Open drive screen** /
  **Leave drive mode** while drive mode is on (one joystick, one place).
  `RecordPanel` stays as is — it is still useful for recording while driving
  with a physical gamepad or OpenMower's own app.

**Layout** (all touch targets ≥ 44 px)

```
┌──────────────────────────────────────────────┐
│ ● Ready · 0.32 m/s · RTK 2 cm    [STOP] [Exit]│
│                                              │
│                 map (follows robot)          │
│            ◉ robot   ─ ─ ─ ⚑ route/target    │
│                                              │
│ ( joystick )          [⚑ Go to] [● Record]   │
│  speed ──●──                                 │
└──────────────────────────────────────────────┘
```

- **Status line**: robot state ("Ready" in `AREA_RECORDING`, otherwise the state
  name and "not accepting commands yet"), current commanded speed, position
  accuracy; warning colour when not ready or accuracy > 0.2 m.
- **STOP**: the existing emergency stop (`sendMowerControl("stop")`), and it
  also cancels go-to and releases the stick.
- **Joystick**: the existing `Joystick.svelte`, larger (≈ 200 px on phones), with
  the existing max-speed slider underneath.
- **Go to**: toggles `picking`. Bottom sheet by phase —
  `picking`: "Tap where the robot should go" + Cancel (+ last `reason` if a pick
  failed); `planned`: "**Go · 12.4 m**" / Cancel, plus the unsaved-edits note if
  applicable; `driving`: remaining distance + large **Stop**;
  `arrived` / `stopped`: result line, auto-dismissed after a few seconds.
- **Record**: tap → chip row **mow / obstacle / nav** → starts the existing
  recorder. While recording: pulsing dot, points · length, **Pause**,
  **Back** (≈ 1 m), **Discard**, **Finish** → existing
  `finishRecording(0.05)`; the zone is created and the screen stays open.
  Go-to works during recording (tap corners to drive straight edges).
- **Keyboard (desktop)**: W A S D / arrows drive as today; `Esc` cancels go-to
  (picking / planned / driving) and never exits the screen.

**Map layer** (`mapController.js`)
- A `goto` layer subscribed to the `goto` store: dashed route polyline from the
  robot through the waypoints, ⚑ target marker; hidden in `idle`.
- In `map.on("click")`, a check *before* the editing-tool dispatch: when
  `goto.phase === "picking"`, the click goes to `pickTarget(meters)` and nothing
  else happens.
- The existing recording preview layer is reused unchanged.

## Error handling

- Planning failures are shown in the sheet with a plain reason ("Target is
  inside an obstacle", "No route — blocked by obstacles", "Robot is outside the
  drivable area", "Target is outside the mow/nav zones", "Map has no mow or
  nav zones").
- Precondition failures disable **Go** with the reason (not in drive mode yet,
  waiting for live position, RTK accuracy too low).
- Every auto-stop shows its reason in the sheet and as a toast.
- `OPENMOWER_CONTROL_DISABLE=1`: drive mode already fails to start, so the
  drive screen is never reached; nothing new to gate.

## Testing

- `src/lib/geo/route.test.js`: direct line when unobstructed (one waypoint);
  detour around a square obstacle (waypoints clear of it by ≥ clearance, path
  shorter than going round the far side); two touching mow zones are crossable;
  target in obstacle → `target-blocked`; target outside → `target-outside`;
  obstacle splitting the region → `no-route`; robot close to an edge can still
  leave; nav zones count as drivable.
- `src/lib/robot/follow.test.js`: turn in place above 35° error; forward with
  proportional turn below; waypoint advance; `done` at the last waypoint;
  `lx`/`az` caps; slow-down near the end; `offRouteDistance`.
- `src/lib/stores/goto.test.js` (fake timers, stubbed `sendTeleop` and pose):
  plan → go → arrive sends zero; each auto-stop rule stops and sends zero;
  joystick input cancels go-to; preconditions block start.
- `src/smoke.test.js`: mount `DriveView` (closed and open).
- **Manual on the robot**: first drives over a short open stretch, then around
  one obstacle, with a hand on STOP; verify blur / hidden-tab stop and the
  off-route stop by nudging with the joystick.

## Files touched

- New: `src/lib/geo/route.js` (+ test), `src/lib/robot/follow.js` (+ test),
  `src/lib/stores/goto.js` (+ test), `src/components/DriveView.svelte`.
- Changed: `src/lib/stores/teleop.js` (cancel go-to on stick input; blur hook),
  `src/lib/stores/ui.js` (`driveView`), `src/components/AppShell.svelte` (mount
  `DriveView`, hide editing chrome while open),
  `src/components/panels/DrivePanel.svelte` (Start opens the screen),
  `src/map/mapController.js` (goto layer, picking click),
  `src/components/CommandPalette.svelte` (entry), `src/smoke.test.js`.
- Docs: README (Robot features, Controls, mapping workflow), AGENTS.md
  (request lifecycle for go-to), CHANGELOG (Unreleased).
