import { describe, it, expect } from "vitest";
import { diffMaps } from "./diff.js";
import { cloneMap } from "./format/mapFormat.js";

const ring = (pts) => [...pts, pts[0]];
const BASE = {
  areas: [
    { id: "a", properties: { type: "mow", name: "front" }, outline: ring([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]) },
    { id: "b", properties: { type: "obstacle" }, outline: ring([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]) },
  ],
  docking_stations: [{ position: { x: 0, y: 0 }, heading: 0 }],
  __editor: { originLat: 52, originLng: 8 },
};

describe("diffMaps", () => {
  it("reports no changes for identical maps", () => {
    expect(diffMaps(BASE, cloneMap(BASE)).empty).toBe(true);
  });

  it("detects added, removed and changed zones", () => {
    const next = cloneMap(BASE);
    next.areas.splice(1, 1);
    next.areas[0].properties.name = "back";
    next.areas[0].outline = ring([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 0, y: 4 }]);
    next.areas.push({ id: "c", properties: { type: "nav" }, outline: ring([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]) });
    const d = diffMaps(BASE, next);
    expect(d.added).toEqual([{ label: "nav 2", type: "nav" }]);
    expect(d.removed).toEqual([{ label: "obstacle 2", type: "obstacle" }]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].changes.join(" ")).toMatch(/renamed to "back"/);
    expect(d.changed[0].changes.join(" ")).toMatch(/outline edited, \+1 pts/);
    expect(d.empty).toBe(false);
  });

  it("detects type and mowing-override changes", () => {
    const next = cloneMap(BASE);
    next.areas[1].properties.type = "nav";
    next.areas[0].properties.outline_count = 2;
    const d = diffMaps(BASE, next);
    const all = d.changed.flatMap((c) => c.changes).join("|");
    expect(all).toContain("type obstacle → nav");
    expect(all).toContain("mowing settings changed");
  });

  it("detects reordering and dock moves", () => {
    const next = cloneMap(BASE);
    next.areas.reverse();
    next.docking_stations[0].position.x = 1;
    next.docking_stations[0].heading = 1;
    const d = diffMaps(BASE, next);
    expect(d.reordered).toBe(true);
    expect(d.dock).toBe("docking station moved 1.00 m, heading changed");
  });

  it("detects projection changes", () => {
    const next = cloneMap(BASE);
    next.__editor.originLat = 53;
    expect(diffMaps(BASE, next).projectionChanged).toBe(true);
  });
});
