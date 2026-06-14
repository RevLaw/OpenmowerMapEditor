import { describe, it, expect } from "vitest";
import { dragBrush } from "./brush.js";
import { snapEvenly, buildCircularIndexPath } from "./snap.js";

describe("drag brush", () => {
  it("moves nearby points along the drag delta, leaves far points", () => {
    const pts = [
      { x: 0.1, y: 0 }, // inside radius
      { x: 5, y: 0 }, // outside radius
    ];
    const { points, moved } = dragBrush(pts, { x: 0, y: 0 }, { x: 1, y: 0 }, 1, 1);
    expect(moved).toBe(1);
    expect(points[0].x).toBeGreaterThan(0.1); // pushed in +x (drag direction)
    expect(points[1]).toEqual({ x: 5, y: 0 });
  });

  it("does nothing with a zero delta", () => {
    const pts = [{ x: 0, y: 0 }];
    expect(dragBrush(pts, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 1).moved).toBe(0);
  });
});

describe("snap line", () => {
  it("builds a forward wrapping index path", () => {
    expect(buildCircularIndexPath(2, 0, 4)).toEqual([2, 3, 0]);
  });

  it("evenly distributes points between endpoints", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 5 },
      { x: 2, y: -3 },
      { x: 3, y: 0 },
    ];
    const { points, changed } = snapEvenly(pts, 0, 3);
    expect(changed).toBe(4);
    expect(points[1].y).toBeCloseTo(0, 9);
    expect(points[2].y).toBeCloseTo(0, 9);
    expect(points[1].x).toBeCloseTo(1, 9);
    expect(points[2].x).toBeCloseTo(2, 9);
  });
});
