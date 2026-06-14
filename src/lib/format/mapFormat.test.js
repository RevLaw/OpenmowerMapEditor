import { describe, it, expect } from "vitest";
import {
  parseMap,
  readEditorMeta,
  writeEditorMeta,
  getAreaType,
  createDefaultZoneOutline,
} from "./mapFormat.js";

describe("mapFormat", () => {
  it("parses a valid map", () => {
    const map = parseMap('{"areas":[]}');
    expect(map.areas).toEqual([]);
  });

  it("throws on a map without an areas array", () => {
    expect(() => parseMap("{}")).toThrow();
  });

  it("reads and writes editor meta", () => {
    const map = { areas: [] };
    expect(readEditorMeta(map)).toBe(null);
    writeEditorMeta(map, { lat: 1.5, lng: 2.5 });
    expect(readEditorMeta(map)).toEqual({ lat: 1.5, lng: 2.5 });
  });

  it("derives the area type with a fallback", () => {
    expect(getAreaType({ properties: { type: "mow" } })).toBe("mow");
    expect(getAreaType({})).toBe("area");
  });

  it("creates a closed default outline", () => {
    const ring = createDefaultZoneOutline({ x: 0, y: 0 }, 1);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });
});
