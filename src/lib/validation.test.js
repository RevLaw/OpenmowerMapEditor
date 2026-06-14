import { describe, it, expect } from "vitest";
import { validateMap } from "./validation.js";

const sq = (s) => [
  { x: 0, y: 0 },
  { x: s, y: 0 },
  { x: s, y: s },
  { x: 0, y: s },
  { x: 0, y: 0 },
];

describe("validateMap", () => {
  it("flags zones with fewer than 3 points", () => {
    const map = { areas: [{ properties: { type: "mow" }, outline: [{ x: 0, y: 0 }] }] };
    const issues = validateMap(map);
    expect(issues.some((i) => i.id.startsWith("few-"))).toBe(true);
  });

  it("flags a self-intersecting (bowtie) outline", () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: 0 },
    ];
    const issues = validateMap({ areas: [{ properties: { type: "mow" }, outline: bowtie }] });
    expect(issues.some((i) => i.id.startsWith("selfint-"))).toBe(true);
  });

  it("flags an obstacle that is not inside any mow area", () => {
    const map = {
      areas: [{ properties: { type: "obstacle" }, outline: sq(1) }],
    };
    const issues = validateMap(map);
    expect(issues.some((i) => i.id.startsWith("orphan-"))).toBe(true);
  });

  it("passes a clean mow area", () => {
    const map = { areas: [{ properties: { type: "mow" }, outline: sq(10) }] };
    expect(validateMap(map)).toEqual([]);
  });
});
