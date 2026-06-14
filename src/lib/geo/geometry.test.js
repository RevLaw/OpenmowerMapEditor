import { describe, it, expect } from "vitest";
import {
  distance,
  isPointInsidePolygon,
  polygonArea,
  polygonPerimeter,
  centroid,
  bestContainingMowAreaIndex,
  segmentsIntersect,
} from "./geometry.js";

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

describe("geometry", () => {
  it("computes distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("computes polygon area and perimeter", () => {
    expect(polygonArea(square)).toBe(4);
    expect(polygonPerimeter(square)).toBe(8);
  });

  it("tests point-in-polygon", () => {
    expect(isPointInsidePolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(isPointInsidePolygon({ x: 3, y: 3 }, square)).toBe(false);
  });

  it("computes centroid", () => {
    expect(centroid(square)).toEqual({ x: 1, y: 1 });
  });

  it("detects properly crossing segments", () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })
    ).toBe(true);
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })
    ).toBe(false);
  });

  it("links a point to the smallest containing mow area", () => {
    const big = square.map((p) => ({ x: p.x * 5, y: p.y * 5 }));
    const areas = [
      { properties: { type: "mow" }, outline: big },
      { properties: { type: "mow" }, outline: square },
    ];
    const getType = (a) => a.properties.type;
    expect(bestContainingMowAreaIndex({ x: 1, y: 1 }, areas, getType)).toBe(1);
    expect(bestContainingMowAreaIndex({ x: 6, y: 6 }, areas, getType)).toBe(0);
  });
});
