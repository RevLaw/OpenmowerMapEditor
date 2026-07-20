import { describe, it, expect } from "vitest";
import {
  pointToSegmentDistance,
  nearestEdgeInsertIndex,
  translatePoints,
  rotatePoints,
  scalePoints,
  boundingBox,
  simplify,
  offsetPolygon,
  principalAngleDeg,
  firstSegmentAngle,
} from "./geometry.js";
import { rectangleOutline, circleOutline } from "../format/shapes.js";

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

describe("point-to-segment + nearest edge", () => {
  it("measures distance to a segment, clamped to endpoints", () => {
    expect(pointToSegmentDistance({ x: 0.5, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(1, 9);
    expect(pointToSegmentDistance({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(1, 9);
  });

  it("inserts on the nearest edge", () => {
    // near the bottom edge (0,0)-(2,0) -> insert at index 1
    expect(nearestEdgeInsertIndex(square, { x: 1, y: -0.1 })).toBe(1);
    // near the left edge (0,2)-(0,0) (closing edge, i=3) -> insert at index 4
    expect(nearestEdgeInsertIndex(square, { x: -0.1, y: 1 })).toBe(4);
  });
});

describe("transforms", () => {
  it("translates", () => {
    expect(translatePoints([{ x: 1, y: 1 }], 2, -3)).toEqual([{ x: 3, y: -2 }]);
  });

  it("rotates 90° about origin", () => {
    const [p] = rotatePoints([{ x: 1, y: 0 }], { x: 0, y: 0 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(1, 9);
  });

  it("scales about center", () => {
    expect(scalePoints([{ x: 2, y: 0 }], { x: 0, y: 0 }, 0.5)).toEqual([{ x: 1, y: 0 }]);
  });

  it("computes a bounding box", () => {
    const bb = boundingBox(square);
    expect(bb).toMatchObject({ minX: 0, minY: 0, maxX: 2, maxY: 2, width: 2, height: 2 });
  });
});

describe("simplify (Douglas–Peucker)", () => {
  it("drops near-collinear points", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.0001 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const out = simplify(pts, 0.01);
    expect(out.length).toBe(4);
  });

  it("never returns fewer than 3 points", () => {
    const out = simplify(square, 100);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

describe("offsetPolygon", () => {
  it("insets a square inward by the distance", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const inner = offsetPolygon(sq, 1);
    expect(inner).toHaveLength(4);
    expect(inner[0].x).toBeCloseTo(1, 6);
    expect(inner[0].y).toBeCloseTo(1, 6);
    expect(inner[2].x).toBeCloseTo(3, 6);
    expect(inner[2].y).toBeCloseTo(3, 6);
  });

  it("offsets outward with a negative distance", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const outer = offsetPolygon(sq, -1);
    expect(outer[0].x).toBeCloseTo(-1, 6);
    expect(outer[0].y).toBeCloseTo(-1, 6);
  });
});

describe("firstSegmentAngle", () => {
  it("uses the first vertex >= 2 m from the start (radians, East=0)", () => {
    // first far point is due north (0,3) -> +90deg
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 3 }];
    expect(firstSegmentAngle(pts)).toBeCloseTo(Math.PI / 2, 6);
  });
  it("returns 0 when nothing is >= 2 m away", () => {
    expect(firstSegmentAngle([{ x: 0, y: 0 }, { x: 0.5, y: 0 }])).toBe(0);
  });
});

describe("principalAngleDeg", () => {
  it("finds the dominant orientation", () => {
    expect(principalAngleDeg([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toBeCloseTo(0, 6);
    expect(Math.abs(principalAngleDeg([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]))).toBeCloseTo(90, 6);
    expect(principalAngleDeg([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBeCloseTo(45, 6);
  });
});

describe("shapes", () => {
  it("builds a rectangle from two corners", () => {
    const r = rectangleOutline({ x: 3, y: 4 }, { x: 1, y: 2 });
    expect(r).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 4 },
      { x: 1, y: 4 },
    ]);
  });

  it("builds a circle polygon with the requested segment count", () => {
    const c = circleOutline({ x: 0, y: 0 }, 1, 16);
    expect(c.length).toBe(16);
    expect(Math.hypot(c[0].x, c[0].y)).toBeCloseTo(1, 9);
  });
});
