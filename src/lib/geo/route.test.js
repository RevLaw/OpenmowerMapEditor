import { describe, it, expect } from "vitest";
import { planRoute, planGoto } from "./route.js";
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

  it("never takes a robot near an obstacle closer than it already is", () => {
    const rock = rect(0, 0, 5, 1);
    const start = { x: 0.05, y: -0.25 }; // 0.25 m below the rock, inside the clearance
    const r = planRoute([zone("mow", rect(-10, -10, 20, 20)), zone("obstacle", rock)], start, { x: -0.6, y: 1.5 });
    expect(r.ok).toBe(true);
    expect(routeClearance(start, r.waypoints, rock)).toBeGreaterThanOrEqual(0.25 - 1e-6);
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

describe("planGoto", () => {
  const lawn = zone("mow", rect(0, 0, 20, 10));

  it("uses the zone-aware route when there is one", () => {
    const r = planGoto([lawn, zone("obstacle", rect(8, 0, 4, 7))], { x: 2, y: 3 }, { x: 18, y: 3 });
    expect(r.ok).toBe(true);
    expect(r.straight).toBe(false);
    expect(r.waypoints.length).toBeGreaterThan(1);
  });

  it("goes in a straight line when the map has no zones", () => {
    const r = planGoto([], { x: 0, y: 0 }, { x: 3, y: 4 });
    expect(r).toEqual({ ok: true, straight: true, waypoints: [{ x: 3, y: 4 }], length: 5 });
  });

  it("goes in a straight line to a target outside the zones", () => {
    const r = planGoto([lawn], { x: 2, y: 5 }, { x: 25, y: 5 });
    expect(r).toMatchObject({ ok: true, straight: true, length: 23 });
  });

  it("goes in a straight line from a robot outside the zones", () => {
    const r = planGoto([lawn], { x: 5, y: -2 }, { x: 5, y: 5 });
    expect(r).toMatchObject({ ok: true, straight: true, length: 7 });
  });

  it("won't draw a straight line through a known obstacle", () => {
    const shed = zone("obstacle", rect(22, 3, 2, 4));
    expect(planGoto([lawn, shed], { x: 2, y: 5 }, { x: 30, y: 5 })).toEqual({ ok: false, reason: "straight-blocked" });
    // ...nor brush past one closer than the clearance.
    expect(planGoto([shed], { x: 20, y: 2.8 }, { x: 26, y: 2.8 })).toEqual({ ok: false, reason: "straight-blocked" });
    expect(planGoto([shed], { x: 20, y: 2 }, { x: 26, y: 2 }).ok).toBe(true);
  });

  it("still refuses a target inside an obstacle within the zones", () => {
    const r = planGoto([lawn, zone("obstacle", rect(8, 3, 4, 4))], { x: 2, y: 5 }, { x: 10, y: 5 });
    expect(r).toEqual({ ok: false, reason: "target-blocked" });
  });
});
