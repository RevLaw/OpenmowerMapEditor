import { describe, it, expect } from "vitest";
import { magnetSnap, closestPointOnSegment } from "./magnet.js";

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe("magnetSnap", () => {
  it("snaps to a vertex within tolerance", () => {
    const r = magnetSnap({ x: 4.1, y: 3.95 }, [square], 0.3);
    expect(r.kind).toBe("vertex");
    expect(r.point).toEqual({ x: 4, y: 4 });
  });

  it("prefers a vertex over a closer edge", () => {
    const r = magnetSnap({ x: 0.2, y: 0.05 }, [square], 0.3);
    expect(r.kind).toBe("vertex");
    expect(r.point).toEqual({ x: 0, y: 0 });
  });

  it("falls back to the nearest edge", () => {
    const r = magnetSnap({ x: 2, y: 0.1 }, [square], 0.3);
    expect(r.kind).toBe("edge");
    expect(r.point.x).toBeCloseTo(2);
    expect(r.point.y).toBeCloseTo(0);
  });

  it("includes the closing edge of the ring", () => {
    const r = magnetSnap({ x: -0.1, y: 2 }, [square], 0.3);
    expect(r.kind).toBe("edge");
    expect(r.point.x).toBeCloseTo(0);
  });

  it("snaps to extra points (e.g. dock)", () => {
    const r = magnetSnap({ x: 10.1, y: 10 }, [square], 0.3, [{ x: 10, y: 10 }]);
    expect(r.point).toEqual({ x: 10, y: 10 });
  });

  it("returns null when nothing is in range", () => {
    expect(magnetSnap({ x: 2, y: 2 }, [square], 0.3)).toBeNull();
    expect(magnetSnap({ x: 4, y: 4 }, [square], 0)).toBeNull();
  });
});

describe("closestPointOnSegment", () => {
  it("clamps to the segment ends", () => {
    expect(closestPointOnSegment({ x: -5, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
