import { describe, it, expect } from "vitest";
import { appendRecordedPoint, slicePath, pathToOutline, pathLength } from "./recorder.js";
import { polygonArea } from "../geo/geometry.js";

describe("appendRecordedPoint", () => {
  it("keeps a point only after moving far enough", () => {
    let pts = appendRecordedPoint([], { x: 0, y: 0 });
    pts = appendRecordedPoint(pts, { x: 0.05, y: 0 });
    expect(pts).toHaveLength(1);
    pts = appendRecordedPoint(pts, { x: 0.2, y: 0 });
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 0.2, y: 0 }]);
  });

  it("returns the same array for invalid or dropped poses", () => {
    const pts = [{ x: 0, y: 0 }];
    expect(appendRecordedPoint(pts, { x: NaN, y: 0 })).toBe(pts);
    expect(appendRecordedPoint(pts, { x: 0.01, y: 0 })).toBe(pts);
  });
});

describe("slicePath", () => {
  const path = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0, t: i }));
  it("slices by fraction, inclusive and order-independent", () => {
    expect(slicePath(path, 0.2, 0.5).map((p) => p.x)).toEqual([2, 3, 4, 5]);
    expect(slicePath(path, 0.5, 0.2).map((p) => p.x)).toEqual([2, 3, 4, 5]);
    expect(slicePath(path, 0, 1)).toHaveLength(11);
    expect(slicePath([], 0, 1)).toEqual([]);
  });
});

describe("pathToOutline", () => {
  it("drops the return-to-start tail and simplifies straight runs", () => {
    const loop = [];
    for (let i = 0; i <= 10; i += 1) loop.push({ x: i, y: 0 });
    for (let i = 1; i <= 10; i += 1) loop.push({ x: 10, y: i });
    for (let i = 9; i >= 0; i -= 1) loop.push({ x: i, y: 10 });
    for (let i = 9; i >= 0; i -= 1) loop.push({ x: 0, y: i * 0.999 });
    const out = pathToOutline(loop, 0.05);
    expect(out).toHaveLength(4); // just the corners, closing-edge points dropped
    expect(polygonArea(out)).toBeCloseTo(100, 0);
  });

  it("rejects paths that enclose no area", () => {
    expect(pathToOutline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }])).toBeNull();
    expect(pathToOutline([{ x: 0, y: 0 }])).toBeNull();
  });
});

describe("pathLength", () => {
  it("sums segment lengths", () => {
    expect(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 5 }])).toBe(6);
  });
});
