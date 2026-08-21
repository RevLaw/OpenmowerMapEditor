import { describe, it, expect } from "vitest";
import {
  appendTrailPoint,
  pruneTrail,
  MIN_TRAIL_DISTANCE_M,
  MAX_TRAIL_AGE_MS,
  MAX_TRAIL_POINTS,
} from "./trail.js";

describe("appendTrailPoint", () => {
  it("keeps the first point", () => {
    const trail = appendTrailPoint([], { x: 1, y: 2 }, 1000);
    expect(trail).toEqual([{ x: 1, y: 2, t: 1000 }]);
  });

  it("drops points closer than MIN_TRAIL_DISTANCE_M to the last kept point", () => {
    const first = appendTrailPoint([], { x: 0, y: 0 }, 1000);
    const dropped = appendTrailPoint(first, { x: MIN_TRAIL_DISTANCE_M / 2, y: 0 }, 1100);
    expect(dropped).toBe(first);
  });

  it("keeps points at least MIN_TRAIL_DISTANCE_M away", () => {
    const first = appendTrailPoint([], { x: 0, y: 0 }, 1000);
    const kept = appendTrailPoint(first, { x: MIN_TRAIL_DISTANCE_M * 2, y: 0 }, 1100);
    expect(kept).toHaveLength(2);
    expect(kept[1]).toEqual({ x: MIN_TRAIL_DISTANCE_M * 2, y: 0, t: 1100 });
  });

  it("ignores non-finite points", () => {
    const trail = appendTrailPoint([], { x: NaN, y: 0 }, 1000);
    expect(trail).toEqual([]);
  });
});

describe("pruneTrail", () => {
  it("drops points older than MAX_TRAIL_AGE_MS", () => {
    const now = 10 * MAX_TRAIL_AGE_MS;
    const trail = [
      { x: 0, y: 0, t: now - MAX_TRAIL_AGE_MS - 1 },
      { x: 1, y: 0, t: now - 10 },
    ];
    expect(pruneTrail(trail, now)).toEqual([{ x: 1, y: 0, t: now - 10 }]);
  });

  it("caps the trail at MAX_TRAIL_POINTS, keeping the most recent", () => {
    const now = MAX_TRAIL_AGE_MS;
    const trail = Array.from({ length: MAX_TRAIL_POINTS + 5 }, (_, i) => ({
      x: i,
      y: 0,
      t: now,
    }));
    const pruned = pruneTrail(trail, now);
    expect(pruned).toHaveLength(MAX_TRAIL_POINTS);
    expect(pruned[0].x).toBe(5);
    expect(pruned[pruned.length - 1].x).toBe(MAX_TRAIL_POINTS + 4);
  });

  it("passes through an empty trail", () => {
    expect(pruneTrail([], 0)).toEqual([]);
  });
});
