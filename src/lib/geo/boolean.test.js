import { describe, it, expect } from "vitest";
import {
  unionOutlines,
  subtractOutline,
  intersectOutlines,
  outlinesOverlap,
  splitOutline,
} from "./boolean.js";
import { polygonArea } from "./geometry.js";

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe("boolean outline ops", () => {
  it("merges two overlapping squares into one outline", () => {
    const { outlines, holes } = unionOutlines(rect(0, 0, 2, 2), rect(1, 1, 2, 2));
    expect(outlines).toHaveLength(1);
    expect(holes).toBe(false);
    expect(polygonArea(outlines[0])).toBeCloseTo(7, 6);
  });

  it("keeps disjoint shapes as separate outlines on union", () => {
    const { outlines } = unionOutlines(rect(0, 0, 1, 1), rect(5, 5, 1, 1));
    expect(outlines).toHaveLength(2);
  });

  it("returns open rings (no duplicated closing point)", () => {
    const { outlines } = unionOutlines(rect(0, 0, 2, 2), rect(1, 1, 2, 2));
    const o = outlines[0];
    expect(o[0]).not.toEqual(o[o.length - 1]);
  });

  it("subtracts a bite out of an edge", () => {
    const { outlines, holes } = subtractOutline(rect(0, 0, 4, 4), rect(3, 1, 2, 2));
    expect(holes).toBe(false);
    expect(polygonArea(outlines[0])).toBeCloseTo(14, 6);
  });

  it("reports a hole when subtracting a fully enclosed shape", () => {
    const { holes } = subtractOutline(rect(0, 0, 4, 4), rect(1, 1, 1, 1));
    expect(holes).toBe(true);
  });

  it("clips an obstacle to the part inside a zone", () => {
    const { outlines } = intersectOutlines(rect(3, 1, 2, 2), rect(0, 0, 4, 4));
    expect(polygonArea(outlines[0])).toBeCloseTo(2, 6);
  });

  it("detects overlap only for a positive shared area", () => {
    expect(outlinesOverlap(rect(0, 0, 2, 2), rect(1, 1, 2, 2))).toBe(true);
    expect(outlinesOverlap(rect(0, 0, 1, 1), rect(1, 0, 1, 1))).toBe(false); // edge-touching
  });

  it("splits a rectangle along a line into two halves", () => {
    const pieces = splitOutline(rect(0, 0, 4, 2), { x: 1, y: -1 }, { x: 1, y: 3 });
    expect(pieces).toHaveLength(2);
    expect(polygonArea(pieces[0])).toBeCloseTo(6, 6);
    expect(polygonArea(pieces[1])).toBeCloseTo(2, 6);
  });

  it("returns a single piece when the split line misses", () => {
    const pieces = splitOutline(rect(0, 0, 4, 2), { x: 10, y: -1 }, { x: 10, y: 3 });
    expect(pieces).toHaveLength(1);
  });
});
