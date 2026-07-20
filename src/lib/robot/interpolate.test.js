import { describe, it, expect } from "vitest";
import { lerp, lerpAngle, poseDist2, stepPose } from "./interpolate.js";

describe("lerp", () => {
  it("interpolates linearly", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });
});

describe("lerpAngle", () => {
  it("takes the short way across the ±π seam", () => {
    // From 170° toward -170° is +20° (not -340°).
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    const mid = lerpAngle(a, b, 0.5);
    // Halfway should be 180° (±π), not 0°.
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
  });

  it("returns endpoints at t=0 and t=1", () => {
    expect(lerpAngle(0.3, 1.2, 0)).toBeCloseTo(0.3, 9);
    expect(lerpAngle(0.3, 1.2, 1)).toBeCloseTo(1.2, 9);
  });

  it("interpolates within a quadrant normally", () => {
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 9);
  });
});

describe("poseDist2", () => {
  it("is squared euclidean distance", () => {
    expect(poseDist2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });
});

describe("stepPose", () => {
  it("moves a fraction toward the target", () => {
    const cur = { x: 0, y: 0, yaw: 0 };
    const target = { x: 4, y: 8, yaw: Math.PI / 2 };
    const next = stepPose(cur, target, 0.25);
    expect(next.x).toBe(1);
    expect(next.y).toBe(2);
    expect(next.yaw).toBeCloseTo(Math.PI / 8, 9);
  });

  it("reaches the target at t=1", () => {
    const next = stepPose({ x: 1, y: 2, yaw: 0.1 }, { x: 5, y: 6, yaw: 0.9 }, 1);
    expect(next).toEqual({ x: 5, y: 6, yaw: expect.closeTo(0.9, 9) });
  });
});
