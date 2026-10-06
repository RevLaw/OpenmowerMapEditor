import { describe, it, expect } from "vitest";
import { stickToTwist, clampStick, keysToStick, MAX_LINEAR, MAX_ANGULAR } from "./teleop.js";

describe("stickToTwist", () => {
  it("is zero at rest and inside the deadzone", () => {
    expect(stickToTwist(0, 0, 1)).toEqual({ lx: 0, az: 0 });
    expect(stickToTwist(0.05, -0.05, 1)).toEqual({ lx: 0, az: 0 });
  });

  it("drives forward / backward on the y axis at full speed", () => {
    expect(stickToTwist(0, 1, 1)).toEqual({ lx: MAX_LINEAR, az: 0 });
    expect(stickToTwist(0, -1, 1).lx).toBeCloseTo(-MAX_LINEAR);
  });

  it("turns right (negative az) when pushed right", () => {
    expect(stickToTwist(1, 0, 1).az).toBeCloseTo(-MAX_ANGULAR);
    expect(stickToTwist(-1, 0, 1).az).toBeCloseTo(MAX_ANGULAR);
  });

  it("scales with the speed setting and uses a soft curve", () => {
    expect(stickToTwist(0, 1, 0.5).lx).toBeCloseTo(MAX_LINEAR / 2);
    const half = stickToTwist(0, 0.5, 1).lx;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(MAX_LINEAR / 2);
  });

  it("never exceeds the limits, even off the unit circle", () => {
    const t = stickToTwist(3, 3, 5);
    expect(Math.abs(t.lx)).toBeLessThanOrEqual(MAX_LINEAR);
    expect(Math.abs(t.az)).toBeLessThanOrEqual(MAX_ANGULAR);
  });
});

describe("clampStick / keysToStick", () => {
  it("clamps to the unit circle", () => {
    const s = clampStick(1, 1);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(1);
  });

  it("maps WASD and arrow keys", () => {
    expect(keysToStick(new Set(["w"]))).toEqual({ x: 0, y: 1 });
    expect(keysToStick(new Set(["arrowleft"]))).toEqual({ x: -1, y: 0 });
    expect(keysToStick(new Set(["w", "s"]))).toEqual({ x: 0, y: 0 });
  });
});
