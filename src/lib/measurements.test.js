import { describe, it, expect } from "vitest";
import { zoneMeasurement, totalMowArea, formatArea } from "./measurements.js";

const sq = (s) => [
  { x: 0, y: 0 },
  { x: s, y: 0 },
  { x: s, y: s },
  { x: 0, y: s },
  { x: 0, y: 0 },
];

describe("measurements", () => {
  it("measures a zone's area and perimeter", () => {
    const m = zoneMeasurement({ outline: sq(3) });
    expect(m.area).toBeCloseTo(9, 9);
    expect(m.perimeter).toBeCloseTo(12, 9);
    expect(m.points).toBe(4);
  });

  it("subtracts contained obstacles from net mowable area", () => {
    const areas = [
      { properties: { type: "mow" }, outline: sq(10) },
      {
        properties: { type: "obstacle" },
        outline: [
          { x: 2, y: 2 },
          { x: 4, y: 2 },
          { x: 4, y: 4 },
          { x: 2, y: 4 },
          { x: 2, y: 2 },
        ],
      },
    ];
    const t = totalMowArea(areas);
    expect(t.mow).toBeCloseTo(100, 9);
    expect(t.obstacle).toBeCloseTo(4, 9);
    expect(t.net).toBeCloseTo(96, 9);
  });

  it("formats areas in m² and hectares", () => {
    expect(formatArea(50)).toBe("50.00 m²");
    expect(formatArea(20000)).toBe("2.00 ha");
  });
});
