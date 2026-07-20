import { describe, it, expect } from "vitest";
import { buildPlanRequest, parsePlanResponse } from "./planRequest.js";

const mow = (props = {}) => ({
  properties: { type: "mow", ...props },
  outline: [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 6 },
    { x: 0, y: 6 },
  ],
});
const obstacle = (cx, cy) => ({
  properties: { type: "obstacle" },
  outline: [
    { x: cx - 0.5, y: cy - 0.5 },
    { x: cx + 0.5, y: cy - 0.5 },
    { x: cx + 0.5, y: cy + 0.5 },
    { x: cx - 0.5, y: cy + 0.5 },
  ],
});
const GP = {
  toolWidth: 0.14,
  outlineCount: 3,
  outlineOverlapCount: 0,
  outlineOffset: 0,
  mowAngleOffset: 0,
  mowAngleOffsetIsAbsolute: false,
};

describe("buildPlanRequest", () => {
  it("resolves global params and auto angle when there are no overrides", () => {
    const req = buildPlanRequest(0, [mow()], GP);
    expect(req.distance).toBe(0.14);
    expect(req.outline_count).toBe(3);
    expect(req.outline_overlap_count).toBe(0);
    expect(req.fill_type).toBe(0);
    expect(req.outline).toHaveLength(4);
    expect(req.outline[1]).toEqual([6, 0]); // [x,y] pairs
    expect(req.angle).toBeCloseTo(0, 9); // first 6 m segment points east → 0 rad
    expect(req.holes).toEqual([]);
  });

  it("lets per-zone overrides win", () => {
    const req = buildPlanRequest(
      0,
      [mow({ outline_count: 5, outline_overlap_count: 2, outline_offset: 0.1, angle: 0.5 })],
      GP
    );
    expect(req.outline_count).toBe(5);
    expect(req.outline_overlap_count).toBe(2);
    expect(req.outer_offset).toBe(0.1);
    expect(req.angle).toBeCloseTo(0.5, 9);
  });

  it("adds the global mow_angle_offset in relative mode", () => {
    const req = buildPlanRequest(0, [mow()], { ...GP, mowAngleOffset: 90 });
    expect(req.angle).toBeCloseTo(Math.PI / 2, 9); // 0 base + 90°
  });

  it("uses the offset alone in absolute mode (per-zone angle ignored)", () => {
    const req = buildPlanRequest(
      0,
      [mow({ angle: 0.5 })],
      { ...GP, mowAngleOffset: 90, mowAngleOffsetIsAbsolute: true }
    );
    expect(req.angle).toBeCloseTo(Math.PI / 2, 9);
  });

  it("includes only obstacles contained in this mow area as holes", () => {
    const areas = [mow(), obstacle(3, 3), obstacle(30, 30)];
    const req = buildPlanRequest(0, areas, GP);
    expect(req.holes).toHaveLength(1);
    expect(req.holes[0]).toHaveLength(4);
  });

  it("returns null for a non-mow or degenerate zone", () => {
    expect(buildPlanRequest(0, [{ properties: { type: "obstacle" }, outline: mow().outline }], GP)).toBeNull();
    expect(buildPlanRequest(0, [{ properties: { type: "mow" }, outline: [{ x: 0, y: 0 }] }], GP)).toBeNull();
    expect(buildPlanRequest(5, [mow()], GP)).toBeNull();
  });
});

describe("parsePlanResponse", () => {
  it("splits outline/fill, converts points, and drops <2-point paths", () => {
    const parsed = parsePlanResponse({
      ok: true,
      paths: [
        { is_outline: 1, pts: [[0, 0], [1, 0]] },
        { is_outline: 0, pts: [[0, 1], [1, 1]] },
        { is_outline: 0, pts: [[5, 5]] },
      ],
      stats: { laps: 1, fillRows: 2, points: 5 },
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.paths).toHaveLength(2);
    expect(parsed.paths[0]).toEqual({ isOutline: true, pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    expect(parsed.paths[1].isOutline).toBe(false);
    expect(parsed.stats.points).toBe(5);
  });

  it("passes through errors", () => {
    const parsed = parsePlanResponse({ ok: false, error: "service unavailable" });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("service unavailable");
    expect(parsed.paths).toEqual([]);
  });
});
