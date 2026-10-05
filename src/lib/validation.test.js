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

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
  { x, y },
];
const zone = (type, outline) => ({ properties: { type }, outline });

describe("validateMap — connectivity, dock and overlap checks", () => {
  it("flags a dock outside every mow and nav zone", () => {
    const map = { areas: [zone("mow", rect(0, 0, 10, 10))], docking_stations: [{ position: { x: 20, y: 20 } }] };
    expect(validateMap(map).some((i) => i.id === "dock-outside")).toBe(true);
  });

  it("flags a mow zone with no nav link to the dock's zone", () => {
    const map = {
      areas: [zone("mow", rect(0, 0, 10, 10)), zone("mow", rect(30, 0, 10, 10))],
      docking_stations: [{ position: { x: 5, y: 5 } }],
    };
    const ids = validateMap(map).map((i) => i.id);
    expect(ids).toContain("unreachable-1");
    expect(ids).not.toContain("unreachable-0");
  });

  it("accepts zones linked by a nav corridor (touching borders count)", () => {
    const map = {
      areas: [
        zone("mow", rect(0, 0, 10, 10)),
        zone("nav", rect(10, 4, 20, 2)), // touches both mow zones edge-to-edge
        zone("mow", rect(30, 0, 10, 10)),
      ],
      docking_stations: [{ position: { x: 5, y: 5 } }],
    };
    expect(validateMap(map).filter((i) => i.id.startsWith("unreachable"))).toEqual([]);
  });

  it("flags an obstacle crossing a mow edge but not one fully inside", () => {
    const map = {
      areas: [zone("mow", rect(0, 0, 10, 10)), zone("obstacle", rect(9, 4, 2, 2)), zone("obstacle", rect(4, 4, 1, 1))],
    };
    const ids = validateMap(map).map((i) => i.id);
    expect(ids).toContain("crossing-1-0");
    expect(ids).not.toContain("crossing-2-0");
  });

  it("flags a mow strip narrower than the cutting width", () => {
    const map = { areas: [zone("mow", rect(0, 0, 10, 0.1)), zone("mow", rect(0, 5, 10, 3))] };
    const ids = validateMap(map, { toolWidth: 0.2 }).map((i) => i.id);
    expect(ids).toContain("narrow-0");
    expect(ids).not.toContain("narrow-1");
  });
});
