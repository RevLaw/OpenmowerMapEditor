import { describe, it, expect } from "vitest";
import {
  isClosedLoop,
  editableCount,
  getEditablePoints,
  closeLoop,
  toEditableIndex,
} from "./outline.js";

const closed = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 0 },
];

describe("outline helpers", () => {
  it("detects a closed loop", () => {
    expect(isClosedLoop(closed)).toBe(true);
    expect(isClosedLoop(closed.slice(0, 3))).toBe(false);
  });

  it("counts editable points (excludes closure)", () => {
    expect(editableCount(closed)).toBe(3);
  });

  it("extracts editable points as copies", () => {
    const pts = getEditablePoints(closed);
    expect(pts).toHaveLength(3);
    pts[0].x = 99;
    expect(closed[0].x).toBe(0); // original untouched
  });

  it("re-closes a ring", () => {
    const ring = closeLoop([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(ring).toHaveLength(4);
    expect(ring[3]).toEqual(ring[0]);
    expect(ring[3]).not.toBe(ring[0]); // distinct object
  });

  it("clamps raw indices to editable range", () => {
    expect(toEditableIndex(0, closed)).toBe(0);
    expect(toEditableIndex(3, closed)).toBe(0); // closure wraps to first
    expect(toEditableIndex(null, closed)).toBe(null);
  });
});
