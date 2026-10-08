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
