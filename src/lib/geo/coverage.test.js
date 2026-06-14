import { describe, it, expect } from "vitest";
import { coverageLines } from "./coverage.js";

const square10 = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("coverageLines", () => {
  it("fills a square with horizontal stripes at the given spacing", () => {
    const segs = coverageLines(square10, [], 2, 0);
    // y = 1,3,5,7,9 -> 5 stripes spanning x 0..10
    expect(segs.length).toBe(5);
    for (const s of segs) {
      expect(Math.min(s.a.x, s.b.x)).toBeCloseTo(0, 6);
      expect(Math.max(s.a.x, s.b.x)).toBeCloseTo(10, 6);
    }
  });

  it("carves an obstacle hole out of the stripes", () => {
    const hole = [
      { x: 3, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 10 },
      { x: 3, y: 10 },
    ];
    const segs = coverageLines(square10, [hole], 2, 0);
    // each scanline is split into two segments (left + right of the hole)
    expect(segs.length).toBe(10);
  });

  it("returns nothing for invalid input", () => {
    expect(coverageLines(square10, [], 0, 0)).toEqual([]);
    expect(coverageLines([{ x: 0, y: 0 }], [], 1, 0)).toEqual([]);
  });
});
