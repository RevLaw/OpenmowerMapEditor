# Fullscreen drive screen & go-to-position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make *Start drive mode* open a fullscreen drive screen (map following the robot, joystick, Record, and Go to — tap the map and the robot drives there around obstacle zones).

**Architecture:** Go-to is automated joystick input: a pure route planner (`geo/route.js`, visibility graph + A* over mow/nav zones minus obstacles) and a pure route follower (`robot/follow.js`) are driven by a store (`stores/goto.js`) that sends commands through the existing `sendTeleop()` → `POST /api/teleop/drive`. The UI is one new overlay component (`DriveView.svelte`) opened by `stores/driveScreen.js`; `mapController.js` draws the route and routes map taps to the picker. No backend changes.

**Tech Stack:** Svelte 5 (runes), Vite 8, Vitest 5 (+ happy-dom for store/component tests), Leaflet 1.9, polygon-clipping 0.15.

**Spec:** `docs/superpowers/specs/2026-10-08-drive-screen-goto-design.md`

## Global Constraints

- JavaScript only, semicolons, double quotes, 2-space indent, `const`/`let` (never `var`); one-line JSDoc on exported `src/lib/**` functions only where the contract isn't obvious (AGENTS.md).
- `src/lib/geo/**` and `src/lib/robot/**` stay framework-free: no Svelte, Leaflet or DOM imports.
- Stores live in `src/lib/stores/*.js`, one concern per file.
- No backend (`server.js`) changes; go-to uses only the existing `sendTeleop()` / `POST /api/teleop/drive`.
- Go-to only while `driveMode === "on"` and the robot reports `AREA_RECORDING`.
- Go-to requires pose `source === "stream"` and `positionAccuracy` non-null and ≤ 0.2 m.
- Clearance margin 0.35 m; waypoint reached within 0.25 m; turn on the spot above 35° heading error.
- Go-to speed 0.3 m/s, never above `MAX_LINEAR` (0.5 m/s); turn rate ≤ `MAX_ANGULAR` (1.5 rad/s).
- Auto-stop: no new pose for 1 s; off-route > 0.5 m; joystick input; window blur / hidden tab / pagehide; drive mode left; teleop rejected, unreachable or unanswered for 1 s. Every stop sends an explicit zero command.
- Touch targets in the drive screen ≥ 44 px.
- Never hand-edit `ros/` or `params/`.

## Review Focus

- **Server stops answering mid-drive** (request hangs) — expect go-to to stop with a reason after 1 s without a response, and later go-tos to still send. Test in Task 3.
- **Robot yaw near ±π** (heading wraps from 3.1 to −3.1) — expect a small heading error and forward driving, not a spin. Test in Task 2.
- **Robot moved between tap and Go** — expect Go to re-plan from the current position. Test in Task 3.
- **Degenerate zones** (fewer than 3 points) or a map with only obstacles — expect them ignored / a clear "no mow or nav zones" reason, not a crash. Test in Task 1.
- **Large map** (400-vertex lawn, 10 obstacles) — expect planning well under a second on a tap. Test in Task 1.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/geo/boolean.js` (modify) | Export the existing `toRing` / `fromRing` helpers for reuse. |
| `src/lib/geo/route.js` (new) | Drivable region, free-point / free-segment tests, corner nodes, A* → `planRoute`. |
| `src/lib/robot/follow.js` (new) | `followStep`, `offRouteDistance`, `remainingDistance`, `wrapAngle`. |
| `src/lib/stores/teleop.js` (modify) | `onDriveInterrupt` hook; joystick / focus-loss interrupts; `enterDriveMode` returns success. |
| `src/lib/stores/goto.js` (new) | Go-to state machine, 10 Hz loop, preconditions, auto-stops. |
| `src/lib/stores/ui.js` (modify) | `driveView` flag. |
| `src/lib/stores/driveScreen.js` (new) | Open / close the drive screen (drive mode, edit mode, follow, Fullscreen API). |
| `src/components/DriveView.svelte` (new) | The fullscreen overlay UI. |
| `src/components/AppShell.svelte` (modify) | Mount `DriveView`, hide editing chrome while open. |
| `src/components/panels/DrivePanel.svelte` (modify) | Start opens the drive screen; no inline joystick. |
| `src/lib/commands.js` (modify) | Palette entry. |
| `src/map/mapController.js` (modify) | Route layer; taps go to the picker. |
| Docs | README, AGENTS.md, CHANGELOG. |

---

### Task 1: Route planner

**Files:**
- Modify: `src/lib/geo/boolean.js:10-22` (export two helpers)
- Create: `src/lib/geo/route.js`
- Test: `src/lib/geo/route.test.js`

**Interfaces:**
- Consumes: `toRing(points)`, `fromRing(ring)` from `geo/boolean.js`; `distance`, `isPointInsidePolygon`, `offsetPolygon`, `pointToSegmentDistance`, `segmentsIntersect`, `simplify` from `geo/geometry.js`.
- Produces: `planRoute(zones, start, target, { clearance = 0.35 } = {})` where `zones = [{ type: "mow"|"nav"|"obstacle"|string, points: [{x,y}] }]` → `{ ok: true, waypoints: [{x,y}], length: number }` (waypoints exclude `start`, last is `target`) or `{ ok: false, reason: "no-drivable-area"|"start-outside"|"target-outside"|"target-blocked"|"no-route" }`. Also exports `DEFAULT_CLEARANCE = 0.35`.

- [ ] **Step 1: Export the ring helpers in `boolean.js`**

Change the two function declarations (bodies unchanged):

```js
export function toRing(points) {
```

```js
export function fromRing(ring) {
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/geo/route.test.js`:

```js
import { describe, it, expect } from "vitest";
import { planRoute } from "./route.js";
import { pointToSegmentDistance } from "./geometry.js";

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const zone = (type, points) => ({ type, points });

// Smallest distance between the route (sampled) and any edge of `ring`.
function routeClearance(start, waypoints, ring) {
  const pts = [start, ...waypoints];
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    for (let t = 0; t <= 1; t += 0.02) {
      const p = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
      for (let k = 0; k < ring.length; k += 1) {
        best = Math.min(best, pointToSegmentDistance(p, ring[k], ring[(k + 1) % ring.length]));
      }
    }
  }
  return best;
}

describe("planRoute", () => {
  const lawn = zone("mow", rect(0, 0, 20, 10));

  it("goes straight when nothing is in the way", () => {
    const r = planRoute([lawn], { x: 2, y: 2 }, { x: 18, y: 2 });
    expect(r.ok).toBe(true);
    expect(r.waypoints).toEqual([{ x: 18, y: 2 }]);
    expect(r.length).toBeCloseTo(16, 6);
  });

  it("detours around an obstacle and keeps the clearance", () => {
    const rock = rect(9, 4, 2, 2);
    const start = { x: 2, y: 5 };
    const r = planRoute([lawn, zone("obstacle", rock)], start, { x: 18, y: 5 });
    expect(r.ok).toBe(true);
    expect(r.waypoints.length).toBeGreaterThan(1);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual({ x: 18, y: 5 });
    expect(routeClearance(start, r.waypoints, rock)).toBeGreaterThanOrEqual(0.35 - 1e-6);
    expect(r.length).toBeGreaterThan(16);
    expect(r.length).toBeLessThan(18);
  });

  it("crosses between two touching mow zones", () => {
    const r = planRoute(
      [zone("mow", rect(0, 0, 10, 10)), zone("mow", rect(10, 0, 10, 10))],
      { x: 5, y: 5 },
      { x: 15, y: 5 }
    );
    expect(r.ok).toBe(true);
    expect(r.waypoints).toEqual([{ x: 15, y: 5 }]);
  });

  it("drives through nav zones", () => {
    const r = planRoute(
      [zone("mow", rect(0, 0, 10, 10)), zone("nav", rect(10, 4, 10, 2)), zone("mow", rect(20, 0, 10, 10))],
      { x: 5, y: 5 },
      { x: 25, y: 5 }
    );
    expect(r.ok).toBe(true);
  });

  it("refuses a target inside an obstacle", () => {
    const r = planRoute([lawn, zone("obstacle", rect(9, 4, 2, 2))], { x: 2, y: 5 }, { x: 10, y: 5 });
    expect(r).toEqual({ ok: false, reason: "target-blocked" });
  });

  it("refuses a target too close to the border", () => {
    const r = planRoute([lawn], { x: 2, y: 5 }, { x: 19.9, y: 5 });
    expect(r).toEqual({ ok: false, reason: "target-blocked" });
  });

  it("refuses a target outside the zones", () => {
    const r = planRoute([lawn], { x: 2, y: 5 }, { x: 30, y: 5 });
    expect(r).toEqual({ ok: false, reason: "target-outside" });
  });

  it("refuses when the robot is outside the zones", () => {
    const r = planRoute([lawn], { x: 30, y: 5 }, { x: 5, y: 5 });
    expect(r).toEqual({ ok: false, reason: "start-outside" });
  });

  it("reports no route when an obstacle cuts the lawn in two", () => {
    const r = planRoute([lawn, zone("obstacle", rect(9, -1, 2, 12))], { x: 2, y: 5 }, { x: 18, y: 5 });
    expect(r).toEqual({ ok: false, reason: "no-route" });
  });

  it("lets a robot parked close to an edge drive away", () => {
    const r = planRoute([lawn], { x: 0.1, y: 5 }, { x: 5, y: 5 });
    expect(r.ok).toBe(true);
  });

  it("needs a mow or nav zone and ignores degenerate zones", () => {
    expect(planRoute([zone("obstacle", rect(0, 0, 5, 5))], { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual({
      ok: false,
      reason: "no-drivable-area",
    });
    const r = planRoute([lawn, zone("mow", [{ x: 0, y: 0 }, { x: 1, y: 1 }])], { x: 2, y: 2 }, { x: 18, y: 2 });
    expect(r.ok).toBe(true);
  });

  it("plans quickly on a large map", () => {
    const circle = Array.from({ length: 400 }, (_, i) => {
      const a = (i / 400) * Math.PI * 2;
      return { x: 25 + 25 * Math.cos(a), y: 25 + 25 * Math.sin(a) };
    });
    const zones = [zone("mow", circle)];
    for (let i = 0; i < 10; i += 1) zones.push(zone("obstacle", rect(8 + (i % 5) * 7, 15 + Math.floor(i / 5) * 15, 2, 2)));
    const t0 = performance.now();
    const r = planRoute(zones, { x: 10, y: 10 }, { x: 40, y: 40 });
    expect(r.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/geo/route.test.js`
Expected: FAIL — `Failed to resolve import "./route.js"`.

- [ ] **Step 4: Implement `route.js`**

Create `src/lib/geo/route.js`:

```js
// Go-to route planning in map meters: the shortest path from the robot to a
// target that stays inside the drivable zones (mow + nav) and keeps
// `clearance` from every border and obstacle zone. Visibility graph over the
// region's corners (pushed out into free space) + A*. No DOM, no Leaflet.
import polygonClipping from "polygon-clipping";
import { toRing, fromRing } from "./boolean.js";
import {
  distance,
  isPointInsidePolygon,
  offsetPolygon,
  pointToSegmentDistance,
  segmentsIntersect,
  simplify,
} from "./geometry.js";

export const DEFAULT_CLEARANCE = 0.35; // m — robot half-width + a buffer
const DRIVABLE_TYPES = new Set(["mow", "nav"]);
const NODE_PUSH = 1.1; // corner nodes sit a little beyond the clearance
const NODE_SIMPLIFY_M = 0.1;
const EPS = 1e-6;

function usable(zone) {
  return Array.isArray(zone?.points) && zone.points.length >= 3;
}

function polygonsOf(zones, test) {
  return zones.filter((z) => usable(z) && test(z.type)).map((z) => [toRing(z.points)]);
}

// Union of mow + nav zones minus obstacle zones, holes kept (boolean.js drops
// holes because map.json can't store them; here obstacles *are* holes).
function buildRegion(zones) {
  const drivable = polygonsOf(zones, (t) => DRIVABLE_TYPES.has(t));
  if (!drivable.length) return null;
  let multi = polygonClipping.union(...drivable);
  const obstacles = polygonsOf(zones, (t) => t === "obstacle");
  if (obstacles.length) multi = polygonClipping.difference(multi, ...obstacles);
  const polygons = multi.map((poly) => poly.map(fromRing).filter((r) => r.length >= 3)).filter((p) => p.length);
  if (!polygons.length) return null;
  const edges = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        edges.push({
          a,
          b,
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxY: Math.max(a.y, b.y),
        });
      }
    }
  }
  return { polygons, edges };
}

function insideRegion(p, region) {
  return region.polygons.some(
    ([outer, ...holes]) => isPointInsidePolygon(p, outer) && !holes.some((h) => isPointInsidePolygon(p, h))
  );
}

function pointFree(p, region, clearance) {
  if (!insideRegion(p, region)) return false;
  return region.edges.every((e) => pointToSegmentDistance(p, e.a, e.b) >= clearance - EPS);
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b)
  );
}

// Borders closer than `clearance` to `exempt` (the robot) are only checked for
// crossing, so a robot parked near an edge can still drive away from it.
function segmentFree(a, b, region, clearance, exempt) {
  const minX = Math.min(a.x, b.x) - clearance;
  const maxX = Math.max(a.x, b.x) + clearance;
  const minY = Math.min(a.y, b.y) - clearance;
  const maxY = Math.max(a.y, b.y) + clearance;
  for (const e of region.edges) {
    if (e.maxX < minX || e.minX > maxX || e.maxY < minY || e.minY > maxY) continue;
    if (exempt && pointToSegmentDistance(exempt, e.a, e.b) < clearance) {
      if (segmentsIntersect(a, b, e.a, e.b)) return false;
      continue;
    }
    if (segmentDistance(a, b, e.a, e.b) < clearance - EPS) return false;
  }
  return true;
}

function cornerNodes(region, clearance) {
  const push = clearance * NODE_PUSH;
  const nodes = [];
  for (const poly of region.polygons) {
    poly.forEach((ring, k) => {
      // offsetPolygon: positive = inward. Outer rings shrink into the region,
      // holes (obstacles) grow out into it. Miter spikes are harmless — every
      // node is validated here and every edge in segmentFree.
      for (const p of offsetPolygon(simplify(ring, NODE_SIMPLIFY_M), k === 0 ? push : -push)) {
        if (pointFree(p, region, clearance)) nodes.push(p);
      }
    });
  }
  return nodes;
}

// A* from nodes[0] (start) to nodes[1] (target); edges are tested lazily, only
// when they would improve a node, so the direct start → target edge goes first.
function shortestPath(nodes, region, clearance) {
  const n = nodes.length;
  const g = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const closed = new Array(n).fill(false);
  const open = new Set([0]);
  g[0] = 0;
  while (open.size) {
    let u = -1;
    let best = Infinity;
    for (const i of open) {
      const f = g[i] + distance(nodes[i], nodes[1]);
      if (f < best) {
        best = f;
        u = i;
      }
    }
    if (u === 1) break;
    open.delete(u);
    closed[u] = true;
    for (let v = 1; v < n; v += 1) {
      if (closed[v]) continue;
      const cand = g[u] + distance(nodes[u], nodes[v]);
      if (cand >= g[v]) continue;
      if (!segmentFree(nodes[u], nodes[v], region, clearance, u === 0 ? nodes[0] : null)) continue;
      g[v] = cand;
      prev[v] = u;
      open.add(v);
    }
  }
  if (!Number.isFinite(g[1])) return null;
  const waypoints = [];
  for (let i = 1; i !== 0; i = prev[i]) waypoints.unshift(nodes[i]);
  return { waypoints, length: g[1] };
}

/**
 * Plan a go-to route. `zones` = [{ type, points }] in map meters. Returns
 * { ok, waypoints (excluding start, ending at target), length } or { ok: false, reason }.
 */
export function planRoute(zones, start, target, { clearance = DEFAULT_CLEARANCE } = {}) {
  const list = zones || [];
  const region = buildRegion(list);
  if (!region) return { ok: false, reason: "no-drivable-area" };
  if (!insideRegion(start, region)) return { ok: false, reason: "start-outside" };
  if (!insideRegion(target, region)) {
    const inDrivable = list.some((z) => usable(z) && DRIVABLE_TYPES.has(z.type) && isPointInsidePolygon(target, z.points));
    return { ok: false, reason: inDrivable ? "target-blocked" : "target-outside" };
  }
  if (!pointFree(target, region, clearance)) return { ok: false, reason: "target-blocked" };
  const nodes = [{ x: start.x, y: start.y }, { x: target.x, y: target.y }, ...cornerNodes(region, clearance)];
  const found = shortestPath(nodes, region, clearance);
  return found ? { ok: true, ...found } : { ok: false, reason: "no-route" };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/geo/route.test.js src/lib/geo/boolean.test.js`
Expected: PASS (all route tests + existing boolean tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/geo/boolean.js src/lib/geo/route.js src/lib/geo/route.test.js
git commit -m "feat: go-to route planner around obstacle zones"
```

---

### Task 2: Route follower

**Files:**
- Create: `src/lib/robot/follow.js`
- Test: `src/lib/robot/follow.test.js`

**Interfaces:**
- Consumes: `distance`, `pointToSegmentDistance` from `geo/geometry.js`; `MAX_LINEAR` (0.5), `MAX_ANGULAR` (1.5) from `robot/teleop.js`.
- Produces:
  - `followStep(pose, waypoints, index, { maxSpeed = 0.3 } = {})` → `{ lx, az, index, done }`; `pose = { x, y, yaw }`.
  - `offRouteDistance(pose, waypoints, index, start)` → number (m).
  - `remainingDistance(pose, waypoints, index)` → number (m).
  - `wrapAngle(a)` → angle in (−π, π].
  - Constants `ARRIVE_M = 0.25`, `TURN_IN_PLACE_RAD` (35°).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/robot/follow.test.js`:

```js
import { describe, it, expect } from "vitest";
import { followStep, offRouteDistance, remainingDistance, wrapAngle } from "./follow.js";

const at = (x, y, yaw = 0) => ({ x, y, yaw });

describe("followStep", () => {
  it("drives straight at a waypoint ahead", () => {
    const s = followStep(at(0, 0), [{ x: 5, y: 0 }], 0);
    expect(s.lx).toBeCloseTo(0.3, 6);
    expect(s.az).toBeCloseTo(0, 6);
    expect(s.done).toBe(false);
  });

  it("turns on the spot (left, CCW +) when the waypoint is far off the heading", () => {
    const s = followStep(at(0, 0), [{ x: 0, y: 5 }], 0);
    expect(s.lx).toBe(0);
    expect(s.az).toBeGreaterThan(0);
  });

  it("turns right (az < 0) for a waypoint behind on the right", () => {
    const s = followStep(at(0, 0), [{ x: -1, y: -5 }], 0);
    expect(s.lx).toBe(0);
    expect(s.az).toBeLessThan(0);
  });

  it("steers proportionally while driving under 35° off", () => {
    const s = followStep(at(0, 0), [{ x: 5, y: 1 }], 0);
    expect(s.lx).toBeGreaterThan(0);
    expect(s.az).toBeGreaterThan(0);
  });

  it("skips reached waypoints", () => {
    const s = followStep(at(4.9, 0), [{ x: 5, y: 0 }, { x: 5, y: 5 }], 0);
    expect(s.index).toBe(1);
  });

  it("is done at the last waypoint and sends zero", () => {
    expect(followStep(at(4.9, 0.1), [{ x: 5, y: 0 }], 0)).toEqual({ lx: 0, az: 0, index: 1, done: true });
  });

  it("caps speed and turn rate", () => {
    expect(followStep(at(0, 0), [{ x: 10, y: 0 }], 0, { maxSpeed: 2 }).lx).toBeCloseTo(0.5, 6);
    expect(Math.abs(followStep(at(0, 0), [{ x: -5, y: 0.01 }], 0).az)).toBeLessThanOrEqual(1.5);
  });

  it("slows down over the last metre", () => {
    const far = followStep(at(0, 0), [{ x: 5, y: 0 }], 0).lx;
    const near = followStep(at(0, 0), [{ x: 0.6, y: 0 }], 0).lx;
    expect(near).toBeLessThan(far);
    expect(near).toBeGreaterThan(0);
  });

  it("handles heading wrap-around at ±π without spinning", () => {
    // Facing almost exactly -x (yaw 3.1); waypoint just below -x (bearing ≈ -3.1).
    const s = followStep(at(0, 0, 3.1), [{ x: -5, y: -0.2 }], 0);
    expect(s.lx).toBeGreaterThan(0);
    expect(Math.abs(s.az)).toBeLessThan(0.5);
  });
});

describe("route helpers", () => {
  it("measures distance to the current route segment", () => {
    expect(offRouteDistance(at(5, 0.4), [{ x: 10, y: 0 }], 0, { x: 0, y: 0 })).toBeCloseTo(0.4, 6);
    expect(offRouteDistance(at(10, 3), [{ x: 10, y: 0 }, { x: 10, y: 10 }], 1, { x: 0, y: 0 })).toBeCloseTo(0, 6);
  });

  it("sums the remaining route", () => {
    expect(remainingDistance(at(0, 0), [{ x: 3, y: 4 }, { x: 3, y: 10 }], 0)).toBeCloseTo(11, 6);
    expect(remainingDistance(at(0, 0), [{ x: 3, y: 4 }], 1)).toBe(0);
  });

  it("wraps angles into (-π, π]", () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/robot/follow.test.js`
Expected: FAIL — `Failed to resolve import "./follow.js"`.

- [ ] **Step 3: Implement `follow.js`**

Create `src/lib/robot/follow.js`:

```js
// Route following for go-to: turns the live pose and the remaining waypoints
// into one joystick-style command { lx, az }. Pure — the go-to store calls it
// ~10×/s and sends the result through the normal teleop channel.
import { distance, pointToSegmentDistance } from "../geo/geometry.js";
import { MAX_LINEAR, MAX_ANGULAR } from "./teleop.js";

export const ARRIVE_M = 0.25; // a waypoint this close counts as reached
export const TURN_IN_PLACE_RAD = (35 * Math.PI) / 180;
const TURN_GAIN = 1.8; // rad/s of turn per rad of heading error
const SLOW_DOWN_M = 1; // ease off over the last metre
const MIN_FORWARD = 0.08; // m/s — keep creeping forward when close

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Angle wrapped into (-π, π]. */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Distance left along the route: pose → waypoints[index] → … → last. */
export function remainingDistance(pose, waypoints, index) {
  if (index >= waypoints.length) return 0;
  let total = distance(pose, waypoints[index]);
  for (let i = index + 1; i < waypoints.length; i += 1) total += distance(waypoints[i - 1], waypoints[i]);
  return total;
}

/**
 * One control step toward waypoints[index]. Reached waypoints are skipped; a
 * large heading error turns on the spot so the robot doesn't swing wide past
 * an obstacle corner. Returns { lx, az, index, done }.
 */
export function followStep(pose, waypoints, index, { maxSpeed = 0.3 } = {}) {
  let i = index;
  while (i < waypoints.length && distance(pose, waypoints[i]) <= ARRIVE_M) i += 1;
  if (i >= waypoints.length) return { lx: 0, az: 0, index: waypoints.length, done: true };
  const wp = waypoints[i];
  const error = wrapAngle(Math.atan2(wp.y - pose.y, wp.x - pose.x) - pose.yaw);
  const az = clamp(TURN_GAIN * error, -MAX_ANGULAR, MAX_ANGULAR);
  if (Math.abs(error) > TURN_IN_PLACE_RAD) return { lx: 0, az, index: i, done: false };
  const cap = clamp(Number(maxSpeed) || 0, 0, MAX_LINEAR);
  const ease = Math.min(1, remainingDistance(pose, waypoints, i) / SLOW_DOWN_M);
  const lx = Math.max(Math.min(MIN_FORWARD, cap), cap * ease) * Math.cos(error);
  return { lx, az, index: i, done: false };
}

/** Distance from the pose to the segment being driven (from `start` for the first). */
export function offRouteDistance(pose, waypoints, index, start) {
  if (index >= waypoints.length) return 0;
  const from = index === 0 ? start : waypoints[index - 1];
  return pointToSegmentDistance(pose, from, waypoints[index]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/robot/follow.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/robot/follow.js src/lib/robot/follow.test.js
git commit -m "feat: route follower for go-to"
```

---

### Task 3: Go-to store and teleop interrupt hook

**Files:**
- Modify: `src/lib/stores/teleop.js` (hook, `setStick`, `enterDriveMode`, `initTeleopSafety`)
- Create: `src/lib/stores/goto.js`
- Test: `src/lib/stores/goto.test.js`

**Interfaces:**
- Consumes: `planRoute` (Task 1); `followStep`, `offRouteDistance`, `remainingDistance` (Task 2); `sendTeleop` from `lib/api.js`; `editor` from `stores/editor.js`; `robotPose` from `stores/robot.js`; `getAreaType` from `format/mapFormat.js`; `getEditablePoints` from `format/outline.js`; `notify` from `stores/toast.js`.
- Produces (teleop.js): `onDriveInterrupt(fn)` → unregister function; `fn(reason)` with `reason` `"joystick"` | `"focus"`. `enterDriveMode()` now resolves to `true`/`false`.
- Produces (goto.js): store `gotoState` = `{ phase: "idle"|"picking"|"planned"|"driving"|"arrived"|"stopped", target, start, waypoints, index, length, remaining, reason }`; functions `armGoto()`, `cancelGoto()`, `pickTarget({x,y})`, `startGoto()`, `stopGoto(reason)` → boolean, `gotoBlocker()` → string (`""` when go-to may run); constant `GOTO_SPEED = 0.3`.

- [ ] **Step 1: Add the interrupt hook to `teleop.js`**

Below `let lastError = 0;` add:

```js
// Other drive sources (go-to) register here; they're told to stop when the
// joystick takes over or the page loses focus.
const interruptHooks = new Set();

/** Register `fn(reason)`, reason "joystick" | "focus". Returns an unregister function. */
export function onDriveInterrupt(fn) {
  interruptHooks.add(fn);
  return () => interruptHooks.delete(fn);
}

function interrupt(reason) {
  interruptHooks.forEach((fn) => fn(reason));
}
```

Replace the body of `setStick` after `const moving = …`:

```js
  if (moving && !timer) {
    interrupt("joystick");
    sendNow();
    timer = setInterval(sendNow, SEND_MS);
  } else if (!moving && timer) {
    releaseStick();
  }
```

(The `&& timer` keeps an idle joystick losing focus — e.g. when tapping the map to pick a go-to target — from sending a stray zero in the middle of a go-to drive. A stick that was driving still always ends with an explicit zero.)

In `enterDriveMode`, after the `if (ok) notify(…)` line add `return ok;`.

In `initTeleopSafety`, replace `halt`:

```js
  const halt = () => {
    interrupt("focus");
    if (timer || stick.x || stick.y) releaseStick();
  };
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/stores/goto.test.js`:

```js
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendTeleop: vi.fn(() => Promise.resolve({ ok: true })),
  stopTeleop: vi.fn(() => Promise.resolve({ ok: true })),
  sendControl: vi.fn(() => Promise.resolve({ ok: true })),
}));

const { sendTeleop } = await import("../api.js");
const { loadMap } = await import("./editor.js");
const { robotPose } = await import("./robot.js");
const { driveMode, setStick, initTeleopSafety } = await import("./teleop.js");
const { gotoState, armGoto, cancelGoto, pickTarget, startGoto, gotoBlocker } = await import("./goto.js");

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function pose(x, y, yaw = 0, extra = {}) {
  robotPose.set({
    ok: true,
    x,
    y,
    yaw,
    positionAccuracy: 0.02,
    source: "stream",
    ros: { telemetry: { stateName: "AREA_RECORDING" } },
    ...extra,
  });
}

const lastCall = () => sendTeleop.mock.calls[sendTeleop.mock.calls.length - 1];

async function driveTo(target) {
  armGoto();
  pickTarget(target);
  startGoto();
  await vi.advanceTimersByTimeAsync(0);
}

describe("go-to store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadMap(JSON.stringify({ areas: [{ id: "a1", properties: { type: "mow" }, outline: rect(0, 0, 20, 10) }] }));
    driveMode.set("on");
    pose(2, 5);
    sendTeleop.mockClear();
    sendTeleop.mockImplementation(() => Promise.resolve({ ok: true }));
  });

  afterEach(() => {
    cancelGoto();
    driveMode.set("off");
    vi.useRealTimers();
  });

  it("needs drive mode", () => {
    driveMode.set("off");
    expect(gotoBlocker()).toMatch(/drive mode/i);
    driveMode.set("on");
    armGoto();
    expect(get(gotoState).phase).toBe("picking");
    pickTarget({ x: 15, y: 5 });
    expect(get(gotoState).phase).toBe("planned");
  });

  it("needs an accurate, streamed pose from a robot in recording mode", () => {
    pose(2, 5, 0, { positionAccuracy: 0.5 });
    expect(gotoBlocker()).toMatch(/accura/i);
    pose(2, 5, 0, { source: "probe" });
    expect(gotoBlocker()).toMatch(/stream/i);
    pose(2, 5, 0, { ros: { telemetry: { stateName: "IDLE" } } });
    expect(gotoBlocker()).toMatch(/accept/i);
  });

  it("shows a reason when the target can't be reached", () => {
    armGoto();
    pickTarget({ x: 40, y: 5 });
    expect(get(gotoState).phase).toBe("picking");
    expect(get(gotoState).reason).toMatch(/outside/i);
  });

  it("drives to the target and sends zero on arrival", async () => {
    await driveTo({ x: 15, y: 5 });
    expect(get(gotoState).phase).toBe("driving");
    expect(lastCall()[0]).toBeGreaterThan(0);
    pose(14.9, 5);
    await vi.advanceTimersByTimeAsync(100);
    expect(get(gotoState).phase).toBe("arrived");
    expect(lastCall()).toEqual([0, 0]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(get(gotoState).phase).toBe("idle");
  });

  it("re-plans from the current position when Go is pressed", () => {
    armGoto();
    pickTarget({ x: 15, y: 5 });
    pose(4, 5);
    startGoto();
    expect(get(gotoState).start).toEqual({ x: 4, y: 5 });
  });

  it("stops when the pose goes stale", async () => {
    await driveTo({ x: 15, y: 5 });
    await vi.advanceTimersByTimeAsync(1200);
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/position/i);
    expect(lastCall()).toEqual([0, 0]);
  });

  it("stops when RTK accuracy drops", async () => {
    await driveTo({ x: 15, y: 5 });
    pose(3, 5, 0, { positionAccuracy: 0.4 });
    await vi.advanceTimersByTimeAsync(100);
    expect(get(gotoState).phase).toBe("stopped");
  });

  it("stops when the robot leaves the route", async () => {
    await driveTo({ x: 15, y: 5 });
    pose(5, 6);
    await vi.advanceTimersByTimeAsync(100);
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/route/i);
  });

  it("gives way to the joystick", async () => {
    await driveTo({ x: 15, y: 5 });
    setStick(0, 0.8);
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/joystick/i);
    setStick(0, 0);
  });

  it("stops when the window loses focus", async () => {
    const cleanup = initTeleopSafety();
    await driveTo({ x: 15, y: 5 });
    window.dispatchEvent(new Event("blur"));
    expect(get(gotoState).phase).toBe("stopped");
    cleanup();
  });

  it("stops when drive mode ends", async () => {
    await driveTo({ x: 15, y: 5 });
    driveMode.set("off");
    expect(get(gotoState).phase).toBe("stopped");
  });

  it("stops when the server rejects a command", async () => {
    sendTeleop.mockImplementation(() => Promise.resolve({ ok: false, error: "nope" }));
    await driveTo({ x: 15, y: 5 });
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/nope/);
  });

  it("stops when the server stops answering, and the next go-to still sends", async () => {
    sendTeleop.mockImplementation(() => new Promise(() => {}));
    await driveTo({ x: 15, y: 5 });
    for (let t = 0; t < 12; t += 1) {
      pose(2 + t * 0.02, 5);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/respond/i);

    sendTeleop.mockImplementation(() => Promise.resolve({ ok: true }));
    sendTeleop.mockClear();
    await driveTo({ x: 15, y: 5 });
    expect(sendTeleop.mock.calls.some(([lx]) => lx > 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/stores/goto.test.js`
Expected: FAIL — `Failed to resolve import "./goto.js"`.

- [ ] **Step 4: Implement `goto.js`**

Create `src/lib/stores/goto.js`:

```js
import { writable, get } from "svelte/store";
import { sendTeleop } from "../api.js";
import { editor } from "./editor.js";
import { robotPose } from "./robot.js";
import { driveMode, robotInRecordingMode, onDriveInterrupt } from "./teleop.js";
import { notify } from "./toast.js";
import { getAreaType } from "../format/mapFormat.js";
import { getEditablePoints } from "../format/outline.js";
import { planRoute } from "../geo/route.js";
import { followStep, offRouteDistance, remainingDistance } from "../robot/follow.js";

// Go to position: tap a target in the drive screen, the editor plans a route
// around obstacle zones (geo/route.js) and steers the robot along it by
// sending joystick commands through the normal teleop channel — OpenMower
// ignores outside navigation goals while idle or recording, so this only works
// in drive mode. Any doubt (stale or inaccurate pose, off the route, joystick
// touched, focus lost, server trouble) stops the robot with an explicit zero.
const TICK_MS = 100;
const POSE_STALE_MS = 1000;
const MAX_ACCURACY_M = 0.2;
const OFF_ROUTE_M = 0.5;
const NO_RESPONSE_MS = 1000;
const DISMISS_MS = { arrived: 4000, stopped: 8000 };
export const GOTO_SPEED = 0.3; // m/s

const ROUTE_REASONS = {
  "no-drivable-area": "The map has no mow or nav zones.",
  "start-outside": "The robot is outside the mow/nav zones (or inside an obstacle).",
  "target-outside": "That spot is outside the mow/nav zones.",
  "target-blocked": "That spot is inside an obstacle or too close to an edge.",
  "no-route": "No route there — blocked by obstacles.",
};
const INTERRUPTS = { joystick: "joystick used.", focus: "the app lost focus." };

const IDLE = { phase: "idle", target: null, start: null, waypoints: [], index: 0, length: 0, remaining: 0, reason: "" };

/** phase: idle | picking | planned | driving | arrived | stopped */
export const gotoState = writable(IDLE);

let lastPose = null;
let lastPoseAt = 0;
let timer = null;
let inFlight = null; // pending sendTeleop promise
let inFlightSince = 0;
let dismissTimer = null;

robotPose.subscribe((p) => {
  if (p?.ok) {
    lastPose = p;
    lastPoseAt = Date.now();
  }
});

/** Why go-to can't run right now, or "" when it can. */
export function gotoBlocker(now = Date.now()) {
  if (get(driveMode) !== "on") return "Start drive mode first.";
  if (!lastPose || now - lastPoseAt > POSE_STALE_MS) return "Waiting for live position.";
  if (!get(robotInRecordingMode)) return "Waiting for the robot to accept commands.";
  if (lastPose.source !== "stream") return "Needs the live position stream.";
  const acc = lastPose.positionAccuracy;
  if (acc == null || !(acc <= MAX_ACCURACY_M)) return "Position not accurate enough (RTK).";
  return "";
}

function currentZones() {
  const areas = get(editor).mapData?.areas || [];
  return areas.map((a) => ({ type: getAreaType(a), points: getEditablePoints(a.outline || []) }));
}

function setState(next) {
  clearTimeout(dismissTimer);
  dismissTimer = null;
  gotoState.set(next);
  const ms = DISMISS_MS[next.phase];
  if (ms) {
    dismissTimer = setTimeout(() => {
      if (get(gotoState) === next) gotoState.set(IDLE);
    }, ms);
  }
}

function plan(target) {
  const start = { x: lastPose.x, y: lastPose.y };
  const res = planRoute(currentZones(), start, target);
  return res.ok ? { start, ...res } : { start, error: ROUTE_REASONS[res.reason] || "No route." };
}

function halt() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const zero = () => sendTeleop(0, 0).catch(() => {});
  zero();
  // A command still in flight could land after the zero — send another after it,
  // and stop waiting for it so the next go-to isn't blocked by a hung request.
  if (inFlight) inFlight.finally(zero);
  inFlight = null;
}

/** Next map tap picks the target. */
export function armGoto() {
  setState({ ...IDLE, phase: "picking" });
}

export function cancelGoto() {
  if (get(gotoState).phase === "driving") halt();
  setState(IDLE);
}

/** Plan a route to `target` ({x, y} in map meters) and wait for Go. */
export function pickTarget(target) {
  const phase = get(gotoState).phase;
  if (phase !== "picking" && phase !== "planned") return;
  const blocker = gotoBlocker();
  if (blocker) {
    setState({ ...IDLE, phase: "picking", reason: blocker });
    return;
  }
  const r = plan(target);
  if (r.error) {
    setState({ ...IDLE, phase: "picking", reason: r.error });
    return;
  }
  setState({ ...IDLE, phase: "planned", target, start: r.start, waypoints: r.waypoints, length: r.length, remaining: r.length });
}

export function startGoto() {
  const s = get(gotoState);
  if (s.phase !== "planned") return;
  const blocker = gotoBlocker();
  if (blocker) {
    setState({ ...s, reason: blocker });
    return;
  }
  // Re-plan from where the robot is now; it may have moved since the tap.
  const r = plan(s.target);
  if (r.error) {
    setState({ ...IDLE, phase: "picking", reason: r.error });
    return;
  }
  setState({ ...s, phase: "driving", start: r.start, waypoints: r.waypoints, length: r.length, remaining: r.length, index: 0, reason: "" });
  timer = setInterval(tick, TICK_MS);
  tick();
}

/** Stop a running go-to (explicit zero). Returns true if it was driving. */
export function stopGoto(reason = "stopped.") {
  const s = get(gotoState);
  if (s.phase !== "driving") return false;
  halt();
  setState({ ...s, phase: "stopped", reason });
  notify(`Go to stopped: ${reason}`, "warn");
  return true;
}

function tick() {
  const s = get(gotoState);
  if (s.phase !== "driving") return;
  const now = Date.now();
  const blocker = gotoBlocker(now);
  if (blocker) {
    stopGoto(blocker);
    return;
  }
  if (inFlight && now - inFlightSince > NO_RESPONSE_MS) {
    stopGoto("the server stopped responding.");
    return;
  }
  if (offRouteDistance(lastPose, s.waypoints, s.index, s.start) > OFF_ROUTE_M) {
    stopGoto("the robot left the route.");
    return;
  }
  const step = followStep(lastPose, s.waypoints, s.index, { maxSpeed: GOTO_SPEED });
  if (step.done) {
    halt();
    setState({ ...s, phase: "arrived", index: step.index, remaining: 0 });
    notify("Go to: arrived.", "success");
    return;
  }
  gotoState.set({ ...s, index: step.index, remaining: remainingDistance(lastPose, s.waypoints, step.index) });
  send(step.lx, step.az);
}

async function send(lx, az) {
  if (inFlight) return;
  const pending = sendTeleop(lx, az);
  inFlight = pending;
  inFlightSince = Date.now();
  try {
    const res = await pending;
    if (res && res.ok === false) stopGoto(`server: ${res.error || "command rejected"}.`);
  } catch (_e) {
    stopGoto("server unreachable.");
  } finally {
    if (inFlight === pending) inFlight = null;
  }
}

driveMode.subscribe((mode) => {
  if (mode === "on") return;
  if (stopGoto("drive mode ended.")) return;
  const phase = get(gotoState).phase;
  if (phase === "picking" || phase === "planned") setState(IDLE);
});

onDriveInterrupt((why) => stopGoto(INTERRUPTS[why] || "stopped."));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/stores/goto.test.js`
Expected: PASS (13 tests).

- [ ] **Step 6: Run the full suite (teleop.js changed)**

Run: `npm test`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/stores/teleop.js src/lib/stores/goto.js src/lib/stores/goto.test.js
git commit -m "feat: go-to store — steer along the route via teleop, stop on any doubt"
```

---

### Task 4: Drive screen open/close and the DriveView component

**Files:**
- Modify: `src/lib/stores/ui.js` (append `driveView`)
- Create: `src/lib/stores/driveScreen.js`
- Create: `src/components/DriveView.svelte`
- Test: `src/lib/stores/driveScreen.test.js`; modify `src/smoke.test.js` (open-state mount)

**Interfaces:**
- Consumes: `driveMode`, `enterDriveMode()` → boolean, `exitDriveMode()`, `driveSpeed`, `driveCommand`, `robotStateName`, `robotInRecordingMode`, `setStick`, `releaseStick` (teleop.js); everything `goto.js` produces (Task 3); `recording`, `startRecording`, `setRecordingPaused`, `trimRecording`, `stopRecording` (recorder.js); `finishRecording(tolerance)` (actions.js); `sendMowerControl` (control.js); `editMode`, `followRobot` (ui.js).
- Produces: `driveView` writable(boolean) in `ui.js`; `openDriveScreen()` → Promise<boolean>; `closeDriveScreen({ leaveDriveMode = true } = {})` → Promise<void>; component `DriveView.svelte` (no props).

- [ ] **Step 1: Add the flag to `ui.js`**

Append:

```js
/** The fullscreen drive screen is open (see stores/driveScreen.js). */
export const driveView = writable(false);
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/stores/driveScreen.test.js`:

```js
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendControl: vi.fn(() => Promise.resolve({ ok: true })),
  sendTeleop: vi.fn(() => Promise.resolve({ ok: true })),
  stopTeleop: vi.fn(() => Promise.resolve({ ok: true })),
}));

const { sendControl } = await import("../api.js");
const { driveView, editMode, followRobot } = await import("./ui.js");
const { driveMode } = await import("./teleop.js");
const { openDriveScreen, closeDriveScreen } = await import("./driveScreen.js");

describe("drive screen", () => {
  beforeEach(() => {
    sendControl.mockClear();
    driveMode.set("off");
    driveView.set(false);
    editMode.set(true);
    followRobot.set(false);
  });

  it("opens in drive mode, hides editing and follows the robot", async () => {
    expect(await openDriveScreen()).toBe(true);
    expect(sendControl).toHaveBeenCalledWith("record_mode");
    expect(get(driveMode)).toBe("on");
    expect(get(driveView)).toBe(true);
    expect(get(editMode)).toBe(false);
    expect(get(followRobot)).toBe(true);
  });

  it("closes, leaves drive mode and restores edit mode", async () => {
    await openDriveScreen();
    await closeDriveScreen();
    expect(sendControl).toHaveBeenLastCalledWith("record_exit");
    expect(get(driveMode)).toBe("off");
    expect(get(driveView)).toBe(false);
    expect(get(editMode)).toBe(true);
  });

  it("closes again when drive mode can't be entered", async () => {
    sendControl.mockImplementationOnce(() => Promise.resolve({ ok: false, error: "busy" }));
    expect(await openDriveScreen()).toBe(false);
    expect(get(driveView)).toBe(false);
    expect(get(editMode)).toBe(true);
  });
});
```

In `src/smoke.test.js`, add at the end of the file:

```js
describe("drive screen mounts open", () => {
  it("renders its controls and the go-to sheet", async () => {
    const { driveView } = await import("./lib/stores/ui.js");
    const { armGoto, cancelGoto } = await import("./lib/stores/goto.js");
    const DriveView = modules["./components/DriveView.svelte"].default;
    driveView.set(true);
    armGoto();
    const view = mountInto(DriveView);
    expect(view.target.textContent).toContain("STOP");
    expect(view.target.textContent).toContain("Tap where the robot should go");
    view.destroy();
    cancelGoto();
    driveView.set(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/stores/driveScreen.test.js src/smoke.test.js`
Expected: FAIL — `driveScreen.js` cannot be resolved; smoke: `modules["./components/DriveView.svelte"]` is undefined.

- [ ] **Step 4: Implement `driveScreen.js`**

Create `src/lib/stores/driveScreen.js`:

```js
import { get } from "svelte/store";
import { driveView, editMode, followRobot } from "./ui.js";
import { driveMode, enterDriveMode, exitDriveMode } from "./teleop.js";
import { cancelGoto } from "./goto.js";

// Opening / closing the fullscreen drive screen: drive mode on, editing chrome
// off, map following the robot, and the browser's Fullscreen API where it
// exists (not on iPhone — the layout fills the viewport there instead).
let editModeBefore = null;

function enterFullscreen() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  } catch (_e) {
    /* not supported */
  }
}

function leaveFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch (_e) {
    /* not supported */
  }
}

/** Show the drive screen and enter drive mode. Resolves false if drive mode couldn't start. */
export async function openDriveScreen() {
  // First, while the click still counts as a user gesture for the Fullscreen API.
  enterFullscreen();
  if (!get(driveView)) {
    editModeBefore = get(editMode);
    editMode.set(false);
    driveView.set(true);
  }
  followRobot.set(true);
  if (get(driveMode) === "off") {
    const ok = await enterDriveMode();
    if (!ok) {
      await closeDriveScreen({ leaveDriveMode: false });
      return false;
    }
  }
  return true;
}

/** Hide the drive screen; by default also leave drive mode (stops go-to and the stick). */
export async function closeDriveScreen({ leaveDriveMode = true } = {}) {
  cancelGoto();
  driveView.set(false);
  if (editModeBefore != null) editMode.set(editModeBefore);
  editModeBefore = null;
  leaveFullscreen();
  if (leaveDriveMode && get(driveMode) === "on") await exitDriveMode();
}
```

- [ ] **Step 5: Implement `DriveView.svelte`**

Create `src/components/DriveView.svelte`:

```svelte
<script>
  import Joystick from "./Joystick.svelte";
  import {
    driveMode,
    driveSpeed,
    driveCommand,
    robotStateName,
    robotInRecordingMode,
    setStick,
    releaseStick,
  } from "../lib/stores/teleop.js";
  import { gotoState, armGoto, cancelGoto, startGoto, stopGoto, gotoBlocker } from "../lib/stores/goto.js";
  import {
    recording,
    startRecording,
    setRecordingPaused,
    trimRecording,
    stopRecording,
  } from "../lib/stores/recorder.js";
  import { finishRecording } from "../lib/actions.js";
  import { sendMowerControl } from "../lib/stores/control.js";
  import { robotPose } from "../lib/stores/robot.js";
  import { editor } from "../lib/stores/editor.js";
  import { isDirty } from "../lib/stores/dirty.js";
  import { driveView, followRobot } from "../lib/stores/ui.js";
  import { closeDriveScreen } from "../lib/stores/driveScreen.js";
  import { MAX_LINEAR } from "../lib/robot/teleop.js";
  import { pathLength } from "../lib/robot/recorder.js";
  import { formatLength } from "../lib/measurements.js";

  // Fullscreen drive screen: the map (following the robot) with the joystick,
  // Go to and boundary recording on top. Go-to's safety rules live in
  // lib/stores/goto.js; this component only shows state and forwards taps.
  const ZONE_TYPES = ["mow", "obstacle", "nav"];
  const ACCURACY_OK_M = 0.2;
  const RECORD_SMOOTHING_M = 0.05;

  let typePicker = $state(false);
  let confirmExit = $state(false);

  let ready = $derived($driveMode === "on" && $robotInRecordingMode);
  let busy = $derived($driveMode === "entering" || $driveMode === "exiting");
  let acc = $derived($robotPose?.ok ? $robotPose.positionAccuracy : null);
  let accOk = $derived(acc != null && acc <= ACCURACY_OK_M);
  let g = $derived($gotoState);
  let gotoActive = $derived(g.phase === "picking" || g.phase === "planned" || g.phase === "driving");
  let recLength = $derived(pathLength($recording.points));
  // gotoBlocker() reads the latest pose; touching the stores re-runs it on every update.
  let blocker = $derived.by(() => {
    void $robotPose;
    void $driveMode;
    void $robotInRecordingMode;
    return gotoBlocker();
  });
  let status = $derived.by(() => {
    if ($driveMode === "entering") return "Switching to drive mode…";
    if ($driveMode === "exiting") return "Leaving drive mode…";
    if (!$robotPose?.ok) return "Waiting for live position…";
    if (!$robotInRecordingMode) return `${$robotStateName || "Unknown state"} — not accepting commands yet`;
    return "Ready";
  });

  function emergencyStop() {
    stopGoto("STOP pressed.");
    releaseStick();
    sendMowerControl("stop");
  }

  function toggleGoto() {
    if (g.phase === "driving") stopGoto("Stop pressed.");
    else if (gotoActive) cancelGoto();
    else armGoto();
  }

  function record(type) {
    typePicker = false;
    startRecording(type);
  }

  function discard() {
    if ($recording.points.length > 20 && !window.confirm("Discard the recorded boundary?")) return;
    stopRecording();
  }

  function exit() {
    if ($recording.active) {
      confirmExit = true;
      return;
    }
    closeDriveScreen();
  }

  function exitFinish() {
    confirmExit = false;
    finishRecording(RECORD_SMOOTHING_M);
    closeDriveScreen();
  }

  function exitDiscard() {
    confirmExit = false;
    stopRecording();
    closeDriveScreen();
  }

  function onKey(e) {
    if (!$driveView || e.key !== "Escape") return;
    if (confirmExit) confirmExit = false;
    else if (g.phase === "driving") stopGoto("Esc pressed.");
    else if (g.phase !== "idle") cancelGoto();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if $driveView}
  <div class="drive pointer-events-none absolute inset-0 z-40 flex flex-col justify-between gap-2">
    <!-- Top: status, follow, STOP, Exit -->
    <div class="flex items-start justify-between gap-2">
      <div class="glass pointer-events-auto flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2 text-xs">
        <span
          class="h-2.5 w-2.5 shrink-0 rounded-full"
          style="background:{ready && accOk ? 'var(--ok)' : 'var(--warn)'}"
        ></span>
        <span class="truncate font-semibold">{status}</span>
        <span class="shrink-0 font-mono text-subtle">{$driveCommand.lx.toFixed(2)} m/s</span>
        <span class="shrink-0 font-mono" class:text-muted={accOk} style={accOk ? "" : "color:var(--warn)"}>
          RTK {acc == null ? "—" : `${Math.round(acc * 100)} cm`}
        </span>
      </div>
      <div class="pointer-events-auto flex shrink-0 gap-2">
        <button
          class="glass dv-btn"
          class:text-accent={$followRobot}
          title={$followRobot ? "Stop following the robot" : "Follow the robot"}
          aria-pressed={$followRobot}
          onclick={() => followRobot.set(!$followRobot)}
        >
          <span class="material-symbols-outlined">{$followRobot ? "my_location" : "location_searching"}</span>
        </button>
        <button class="dv-btn dv-stop" title="Emergency stop" onclick={emergencyStop}>STOP</button>
        <button class="glass dv-btn" disabled={busy} title="Leave drive mode" onclick={exit}>
          <span class="material-symbols-outlined">logout</span>
          Exit
        </button>
      </div>
    </div>

    <!-- Bottom: sheets, then joystick (left) and actions (right) -->
    <div class="flex flex-col gap-2">
      {#if gotoActive || g.phase === "arrived" || g.phase === "stopped"}
        <div class="glass pointer-events-auto mx-auto w-full max-w-md rounded-2xl px-3 py-2 text-xs">
          {#if g.phase === "picking"}
            <div class="flex items-center justify-between gap-2">
              <span>Tap where the robot should go.</span>
              <button class="btn dv-sheet-btn" onclick={cancelGoto}>Cancel</button>
            </div>
            {#if g.reason}<p class="mt-1" style="color:var(--warn)">{g.reason}</p>{/if}
          {:else if g.phase === "planned"}
            <div class="flex items-center gap-2">
              <button class="btn btn-accent dv-sheet-btn flex-1" disabled={!!blocker} onclick={startGoto}>
                <span class="material-symbols-outlined" style="font-size:18px">flag</span>
                Go · {formatLength(g.length)}
              </button>
              <button class="btn dv-sheet-btn" onclick={cancelGoto}>Cancel</button>
            </div>
            {#if blocker || g.reason}<p class="mt-1" style="color:var(--warn)">{blocker || g.reason}</p>{/if}
            {#if $isDirty}<p class="mt-1 text-subtle">Route uses unsaved map edits.</p>{/if}
          {:else if g.phase === "driving"}
            <div class="flex items-center gap-2">
              <span class="flex-1">Driving to the target · {formatLength(g.remaining)} left</span>
              <button class="dv-btn dv-stop" onclick={() => stopGoto("Stop pressed.")}>Stop</button>
            </div>
          {:else if g.phase === "arrived"}
            <span>Arrived.</span>
          {:else}
            <span style="color:var(--warn)">Stopped: {g.reason}</span>
          {/if}
        </div>
      {/if}

      {#if $recording.active}
        <div class="glass pointer-events-auto mx-auto w-full max-w-md rounded-2xl px-3 py-2 text-xs">
          <div class="mb-2 flex items-center gap-2">
            <span class="rec-dot" class:paused={$recording.paused}></span>
            <span class="flex-1 font-semibold">
              {$recording.paused ? "Paused" : "Recording"} {$recording.type} zone ·
              {$recording.points.length} points · {formatLength(recLength)}
            </span>
          </div>
          <div class="grid grid-cols-4 gap-1.5">
            <button class="btn dv-sheet-btn" onclick={() => setRecordingPaused(!$recording.paused)}>
              {$recording.paused ? "Resume" : "Pause"}
            </button>
            <button class="btn dv-sheet-btn" disabled={!$recording.points.length} onclick={() => trimRecording(10)}>
              Back
            </button>
            <button class="btn dv-sheet-btn" onclick={discard}>Discard</button>
            <button
              class="btn btn-accent dv-sheet-btn"
              disabled={$recording.points.length < 3}
              onclick={() => finishRecording(RECORD_SMOOTHING_M)}
            >
              Finish
            </button>
          </div>
        </div>
      {:else if typePicker}
        <div class="glass pointer-events-auto mx-auto flex gap-1.5 rounded-2xl p-2 text-xs">
          <span class="self-center px-1 text-subtle">Record a</span>
          {#each ZONE_TYPES as type (type)}
            <button class="btn dv-sheet-btn" onclick={() => record(type)}>{type}</button>
          {/each}
          <span class="self-center px-1 text-subtle">zone</span>
        </div>
      {/if}

      <div class="flex items-end justify-between gap-3">
        <div class="glass pointer-events-auto flex flex-col items-center gap-2 rounded-3xl p-3">
          <Joystick onChange={setStick} disabled={busy} size={176} />
          <label class="flex w-full items-center gap-2 text-[11px] text-muted">
            Max
            <input
              class="slider flex-1"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              aria-label="Maximum joystick speed"
              bind:value={$driveSpeed}
            />
            <span class="font-mono text-accent">{($driveSpeed * MAX_LINEAR).toFixed(2)}</span>
          </label>
        </div>
        <div class="pointer-events-auto flex flex-col gap-2">
          <button class="glass dv-action" class:on={gotoActive} disabled={$driveMode !== "on"} onclick={toggleGoto}>
            <span class="material-symbols-outlined">flag</span>
            {gotoActive ? "Cancel" : "Go to"}
          </button>
          <button
            class="glass dv-action"
            class:on={$recording.active || typePicker}
            disabled={$recording.active || !$editor.mapData}
            onclick={() => (typePicker = !typePicker)}
          >
            <span class="material-symbols-outlined is-filled" style="color:var(--danger)">radio_button_checked</span>
            Record
          </button>
        </div>
      </div>
    </div>
  </div>

  {#if confirmExit}
    <div class="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="glass w-full max-w-xs rounded-2xl p-4 text-sm" role="dialog" aria-modal="true" aria-label="Recording in progress">
        <p class="mb-3 font-semibold">A recording is still running.</p>
        <div class="flex flex-col gap-2">
          <button class="btn btn-accent dv-sheet-btn" disabled={$recording.points.length < 3} onclick={exitFinish}>
            Finish &amp; create zone
          </button>
          <button class="btn dv-sheet-btn" onclick={exitDiscard}>Discard recording</button>
          <button class="btn dv-sheet-btn" onclick={() => (confirmExit = false)}>Stay</button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .drive {
    padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
      max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  }
  .dv-btn {
    display: inline-flex;
    min-height: 44px;
    min-width: 44px;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 14px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .dv-stop {
    background: var(--danger);
    color: #fff;
    letter-spacing: 0.04em;
  }
  .dv-action {
    display: flex;
    min-height: 48px;
    min-width: 104px;
    align-items: center;
    gap: 6px;
    border-radius: 16px;
    padding: 0 14px;
    font-size: 13px;
    font-weight: 600;
  }
  .dv-action.on {
    color: var(--accent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .dv-sheet-btn {
    min-height: 44px;
  }
  .dv-btn:disabled,
  .dv-action:disabled {
    opacity: 0.45;
  }
  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
    animation: rec-pulse 1.4s infinite;
  }
  .rec-dot.paused {
    background: var(--warn);
    animation: none;
  }
  @keyframes rec-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 60%, transparent);
    }
    70% {
      box-shadow: 0 0 0 8px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }
</style>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/stores/driveScreen.test.js src/smoke.test.js`
Expected: PASS (the smoke glob also mounts `DriveView` closed automatically).

- [ ] **Step 7: Commit**

```bash
git add src/lib/stores/ui.js src/lib/stores/driveScreen.js src/lib/stores/driveScreen.test.js src/components/DriveView.svelte src/smoke.test.js
git commit -m "feat: fullscreen drive screen with joystick, go-to and recording"
```

---

### Task 5: Wire the drive screen into the app

**Files:**
- Modify: `src/components/AppShell.svelte`
- Modify: `src/components/panels/DrivePanel.svelte`
- Modify: `src/lib/commands.js`

**Interfaces:**
- Consumes: `driveView` (ui.js), `openDriveScreen()` (driveScreen.js), `DriveView.svelte` (Task 4).
- Produces: nothing new for later tasks.

- [ ] **Step 1: AppShell — mount the drive screen and hide editing chrome**

In the `<script>` imports add:

```js
  import DriveView from "./DriveView.svelte";
```

and extend the ui.js import:

```js
  import { backupsOpen, sidebarOpen, editMode, driveView } from "../lib/stores/ui.js";
```

In the template:
- `{#if $sidebarOpen}` → `{#if $sidebarOpen && !$driveView}`
- `{#if !$sidebarOpen}` → `{#if !$sidebarOpen && !$driveView}`
- Tool-dock wrapper `<div bind:this={toolDockWrapEl} class="absolute right-3 z-20" …>` → add `class:hidden={$driveView}` (keep it mounted: the ResizeObserver watches it).
- Top-centre wrapper `<div class="pointer-events-none absolute left-1/2 top-3 z-20 …">` → add `class:hidden={$driveView}`.
- Robot HUD wrapper `<div class="absolute right-3 top-3 z-20 overflow-y-auto" …>` → add `class:hidden={$driveView}` (keep mounted for the same reason).
- Map controls wrapper `<div class="absolute bottom-3 z-30 flex flex-col items-start gap-2 …">` → add `class:hidden={$driveView}`.
- Before `<StatusToasts />` add `<DriveView />`.

(Selection bar needs nothing: it only renders in edit mode, which the drive screen turns off.)

- [ ] **Step 2: DrivePanel — Start opens the drive screen**

Replace `src/components/panels/DrivePanel.svelte` with:

```svelte
<script>
  import Collapsible from "../Collapsible.svelte";
  import { driveMode, robotStateName, robotInRecordingMode, exitDriveMode } from "../../lib/stores/teleop.js";
  import { openDriveScreen } from "../../lib/stores/driveScreen.js";
  import { robotLive, robotPose } from "../../lib/stores/robot.js";

  let live = $derived($robotLive && $robotPose?.ok);
  let on = $derived($driveMode === "on");
  let busy = $derived($driveMode === "entering" || $driveMode === "exiting");
</script>

<Collapsible title="Drive the mower" icon="sports_esports" key="drive">
  <p class="mb-2 text-[11px] text-subtle">
    Opens a fullscreen drive screen: an on-screen joystick, <b>Go to</b> (tap the map and the robot drives there,
    around obstacle zones) and <b>Record</b> to turn the driven path into a zone. This puts OpenMower into its
    area-recording mode — the blade stays off, and nothing is saved on the robot itself.
  </p>

  {#if !on}
    <p class="mb-2 flex items-start gap-1.5 text-[11px]" style="color:var(--warn)">
      <span class="material-symbols-outlined" style="font-size:15px">warning</span>
      This moves the real robot. Keep it in sight; STOP is an emergency stop.
    </p>
    <button class="btn btn-accent w-full" disabled={busy} onclick={() => openDriveScreen()}>
      <span class="material-symbols-outlined" style="font-size:18px">sports_esports</span>
      {$driveMode === "entering" ? "Switching to drive mode…" : "Start drive mode"}
    </button>
    {#if $robotInRecordingMode}
      <p class="mt-1 text-[10px] text-subtle">The robot is already in area-recording mode.</p>
    {/if}
  {:else}
    <div class="mb-2 flex items-center gap-1.5 text-[11px]">
      <span class="h-2 w-2 rounded-full" style="background:{$robotInRecordingMode ? 'var(--ok)' : 'var(--warn)'}"></span>
      {#if !live}
        Waiting for live position…
      {:else if $robotInRecordingMode}
        Ready — robot in recording mode
      {:else}
        Robot state: {$robotStateName || "unknown"} (not accepting joystick yet)
      {/if}
    </div>
    <button class="btn btn-accent w-full" onclick={() => openDriveScreen()}>
      <span class="material-symbols-outlined" style="font-size:18px">open_in_full</span>
      Open drive screen
    </button>
    <button class="btn mt-1.5 w-full" disabled={busy} onclick={exitDriveMode}>
      <span class="material-symbols-outlined" style="font-size:18px">logout</span>
      {$driveMode === "exiting" ? "Leaving drive mode…" : "Leave drive mode"}
    </button>
  {/if}
</Collapsible>
```

- [ ] **Step 3: Command palette entry**

In `src/lib/commands.js` add the import:

```js
import { openDriveScreen } from "./stores/driveScreen.js";
```

and next to the `{ id: "robot", … }` entry (group "View") add:

```js
    { id: "drive-screen", title: "Drive the mower (fullscreen drive screen)", group: "View", icon: "sports_esports", run: () => openDriveScreen() },
```

- [ ] **Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests pass; build prints `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppShell.svelte src/components/panels/DrivePanel.svelte src/lib/commands.js
git commit -m "feat: Start drive mode opens the drive screen"
```

---

### Task 6: Route layer and map taps

**Files:**
- Modify: `src/map/mapController.js` (imports ~line 54, `layers` ~line 158, zone click ~line 361, map click ~line 1490, subscriptions ~line 1969)

**Interfaces:**
- Consumes: `gotoState`, `pickTarget({x,y})` from `stores/goto.js`; existing `toLatLng`, `latLngToMeters`, `origin()` in mapController.
- Produces: nothing new.

- [ ] **Step 1: Import and layer slot**

Below `import { recording } from "../lib/stores/recorder.js";` add:

```js
import { gotoState, pickTarget } from "../lib/stores/goto.js";
```

In the `layers` object, after `trailZone: null,` add `gotoRoute: null,`.

- [ ] **Step 2: Render the route and send taps to the picker**

After `function renderTrailZone(…) { … }` add:

```js
  // ---- go-to route preview ------------------------------------------------

  function renderGoto(g) {
    if (layers.gotoRoute) map.removeLayer(layers.gotoRoute);
    layers.gotoRoute = null;
    if (!g?.target || (g.phase !== "planned" && g.phase !== "driving")) return;
    const group = L.layerGroup();
    const lls = [g.start, ...g.waypoints].map(toLatLng);
    L.polyline(lls, { color: "#38bdf8", weight: 3, dashArray: "6,6", opacity: 0.95, interactive: false }).addTo(group);
    L.circleMarker(toLatLng(g.target), { radius: 7, color: "#fff", weight: 2, fillColor: "#38bdf8", fillOpacity: 1, interactive: false }).addTo(group);
    layers.gotoRoute = group.addTo(map);
  }

  /** While go-to waits for a target, a tap anywhere on the map (zones included) picks it. */
  function tryPickGoto(latlng) {
    const phase = get(gotoState).phase;
    if (phase !== "picking" && phase !== "planned") return false;
    pickTarget(latLngToMeters(latlng, origin()));
    return true;
  }
```

Zone polygons stop click propagation (they select the zone), so the picker must be checked there too. In the zone polygon click handler, right after `L.DomEvent.stopPropagation(e);` add:

```js
          if (tryPickGoto(e.latlng)) return;
```

In `map.on("click", (e) => {`, after the `suppressNextClick` block and before `const raw = …`, add:

```js
    if (tryPickGoto(e.latlng)) return;
```

In the subscriptions, after `unsubs.push(recording.subscribe((r) => renderRecording(r)));` add:

```js
  unsubs.push(gotoState.subscribe((g) => renderGoto(g)));
```

- [ ] **Step 3: Run tests and build**

Run: `npm test && npm run build`
Expected: all pass; build succeeds.

- [ ] **Step 4: Check it in the browser (dev, no robot)**

Run the backend and `npm run dev` as in CLAUDE.md; open http://localhost:5173. Robot tab → **Start drive mode**: the drive screen opens, then closes again with a "Mower: …" toast because no ROS container runs locally (the expected failure path). Verify: sidebar, tool dock, HUD and map controls hide while open and return after; no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/map/mapController.js
git commit -m "feat: draw the go-to route and pick targets by tapping the map"
```

---

### Task 7: Docs

**Files:**
- Modify: `README.md` (Robot features, Controls, Usage notes)
- Modify: `AGENTS.md` (walkthrough, request lifecycles, safety notes)
- Modify: `CHANGELOG.md` (Unreleased)

- [ ] **Step 1: README**

In **Features → Robot**, replace the "Drive with an on-screen joystick" bullet and the "Record a zone by driving" bullet with:

```markdown
- **Drive screen** — *Start drive mode* opens a fullscreen map that follows the robot, with an on-screen joystick (touch, mouse or `W A S D`), **Go to** and **Record**. Drive mode switches OpenMower into its area-recording mode, the only mode in which it accepts joystick commands; the blade stays off. The robot stops when you let go, when the tab loses focus, or when commands stop arriving for 0.4 s, and speed is capped at 0.5 m/s.
- **Go to** — tap a spot and the robot drives there by itself (0.3 m/s), routing around obstacle zones and keeping 35 cm from zone edges. It stops on STOP, when you touch the joystick, if its position gets stale or RTK accuracy is worse than 20 cm, or if it strays 0.5 m off the route.
- **Record a zone by driving** around it (drive screen or Robot tab), or turn a stretch of the movement trail into a zone.
```

In **Controls**, add a row before "Context menu":

```markdown
| Go to (drive screen) | **Go to** → tap the target → **Go** · `Esc` cancels |
```

In **Usage notes**, replace the robot-assisted mapping bullet with:

```markdown
- Typical robot-assisted mapping: **Robot** tab → *Start drive mode* → **Record** → drive around the area (joystick, or **Go to** corner by corner) → **Finish** → **Exit** → save.
```

- [ ] **Step 2: AGENTS.md**

In walkthrough item 3 (`src/lib/geo/`), after "…outer rings because `map.json` outlines can't have holes)" add: "; `geo/route.js` plans go-to routes (visibility graph + A* over mow + nav zones minus obstacles, holes kept)".

In item 5 (`src/components/`), after the sentence naming `RobotHud.svelte` add: "`DriveView.svelte` is the fullscreen drive screen (joystick, Go to, Record), opened and closed by `stores/driveScreen.js`."

In **Request lifecycles**, after the **Joystick driving** bullet add:

```markdown
- **Go to position**: OpenMower's own planner can't be commanded from
  outside — in IDLE and AREA_RECORDING `mower_logic` publishes on
  `logic_vel`, which outranks `move_base_flex`'s `nav_vel` in `twist_mux` —
  so go-to is automated joystick input. `src/lib/geo/route.js` plans the
  route, `src/lib/stores/goto.js` steers along it ~10×/s with
  `src/lib/robot/follow.js` and sends each command through the same
  `POST /api/teleop/drive` as the stick. It only runs in drive mode and
  stops on any doubt (stale or inaccurate pose, off-route, joystick, focus
  loss, server error); `teleop.js`'s `onDriveInterrupt` hook is how the
  joystick and focus-loss safety reach it.
```

In **Security notes**, extend the last bullet ("Anything that can move the robot must fail safe…") so it ends: "…kill-before-start cleanup intact when touching that code, and go-to's auto-stop rules in `stores/goto.js`."

- [ ] **Step 3: CHANGELOG**

Add at the top, under `# Changelog`:

```markdown
## Unreleased

### Added
- **Drive screen** — *Start drive mode* now opens a fullscreen map that
  follows the robot, with the joystick, a speed slider, STOP, and recording
  controls (Record → mow / obstacle / nav → Pause / Back / Discard / Finish)
  on top.
- **Go to** — tap the map and the robot drives there by itself, on a route
  that avoids obstacle zones and keeps 35 cm from zone edges (planned in the
  editor; OpenMower's own planner can't be commanded from outside). Runs only
  in drive mode with live RTK position, at 0.3 m/s, and stops on STOP,
  joystick input, focus loss, a stale or inaccurate position, drifting off the
  route, or a server error.

### Changed
- The Robot tab's Drive panel opens the drive screen instead of showing an
  inline joystick.
```

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md CHANGELOG.md
git commit -m "docs: drive screen and go-to"
```

---

### Task 8: Verification on the real robot (with the user present)

Go-to moves a physical robot; this task is done **together with the user**, who keeps a hand on STOP. Do not start it without them.

- [ ] **Step 1: Full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 2: Point a local server at the mower**

The robot's own editor container runs the published image, so test from the dev machine through an SSH-forwarded Docker socket and copies of the robot's map and params in the scratchpad (never edit `ros/` / `params/` in the repo):

```bash
ssh -N -L /tmp/om-docker.sock:/var/run/docker.sock openmower.local &
scp openmower.local:/home/openmower/ros/map.json "$SCRATCH/map.json"
scp openmower.local:/home/openmower/params/mower_params.yaml "$SCRATCH/mower_params.yaml"
PORT=5080 DOCKER_SOCKET_PATH=/tmp/om-docker.sock MAP_PATH="$SCRATCH/map.json" PARAMS_PATH="$SCRATCH/mower_params.yaml" node server.js
npm run dev
```

- [ ] **Step 3: Manual checks (user holds STOP)**

1. Start drive mode → drive screen opens, status reaches "Ready", RTK shows centimetres.
2. Joystick drives the robot; releasing stops it.
3. Go to a spot ~3 m away in open lawn → robot turns, drives, stops on arrival.
4. Go to a spot behind an obstacle zone → route bends around it; robot follows.
5. During a go-to, touch the joystick → stops ("joystick used").
6. During a go-to, switch browser tab → stops ("the app lost focus").
7. During a go-to, nudge the robot sideways > 0.5 m with the joystick → stops.
8. Record a small zone with go-to corners → Finish creates it; Exit leaves drive mode.

Record the results in the PR description.
