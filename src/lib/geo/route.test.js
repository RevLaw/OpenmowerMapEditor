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
