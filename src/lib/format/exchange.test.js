import { describe, it, expect } from "vitest";
import { mapToGeoJSON, parseGeoJSON, mapToKML, parseKML, detectExchangeFormat } from "./exchange.js";

const origin = { lat: 52.1, lng: 8.2 };
const ring = (pts) => [...pts, pts[0]];
const MAP = {
  areas: [
    {
      id: "z1",
      properties: { type: "mow", name: "Front & back", outline_count: 2, angle: 1.5 },
      outline: ring([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 0, y: 5 },
      ]),
    },
    {
      id: "z2",
      properties: { type: "obstacle" },
      outline: ring([
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
      ]),
    },
  ],
  docking_stations: [{ position: { x: 1, y: -1 }, heading: 0.5 }],
};

function expectSameOutline(imported, area) {
  const src = area.outline.slice(0, -1);
  expect(imported.points).toHaveLength(src.length);
  imported.points.forEach((p, i) => {
    expect(p.x).toBeCloseTo(src[i].x, 2);
    expect(p.y).toBeCloseTo(src[i].y, 2);
  });
}

describe("GeoJSON exchange", () => {
  it("exports zones as closed lng/lat polygons plus a dock point", () => {
    const fc = mapToGeoJSON(MAP, origin);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(3);
    const poly = fc.features[0];
    expect(poly.geometry.type).toBe("Polygon");
    const coords = poly.geometry.coordinates[0];
    expect(coords[0]).toEqual(coords[coords.length - 1]);
    expect(coords[0][0]).toBeCloseTo(8.2, 6); // lng first
    expect(poly.properties).toMatchObject({ type: "mow", name: "Front & back", id: "z1", outline_count: 2 });
    expect(fc.features[2].properties).toEqual({ type: "dock", heading: 0.5 });
  });

  it("round-trips zones, properties and the dock", () => {
    const { areas, dock, skipped } = parseGeoJSON(JSON.stringify(mapToGeoJSON(MAP, origin)), origin);
    expect(skipped).toBe(0);
    expect(areas).toHaveLength(2);
    expectSameOutline(areas[0], MAP.areas[0]);
    expect(areas[0].properties).toEqual({ type: "mow", name: "Front & back", outline_count: 2, angle: 1.5 });
    expect(areas[0].id).toBe("z1");
    expect(areas[1].properties.type).toBe("obstacle");
    expect(dock.position.x).toBeCloseTo(1, 2);
    expect(dock.heading).toBe(0.5);
  });

  it("imports MultiPolygons and bare geometries, using the default type", () => {
    const multi = {
      type: "MultiPolygon",
      coordinates: [
        [[[8.2, 52.1], [8.2001, 52.1], [8.2001, 52.1001], [8.2, 52.1]]],
        [[[8.3, 52.1], [8.3001, 52.1], [8.3001, 52.1001], [8.3, 52.1]]],
      ],
    };
    const { areas } = parseGeoJSON(multi, origin, "nav");
    expect(areas).toHaveLength(2);
    expect(areas[0].properties.type).toBe("nav");
  });

  it("skips unsupported geometry and rejects non-GeoJSON", () => {
    const fc = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [8, 52] } }] };
    expect(parseGeoJSON(fc, origin).skipped).toBe(1);
    expect(() => parseGeoJSON({ foo: 1 }, origin)).toThrow();
  });
});

describe("KML exchange", () => {
  it("round-trips zones, names with XML characters, and the dock", () => {
    const kml = mapToKML(MAP, origin);
    expect(kml).toContain("Front &amp; back");
    const { areas, dock } = parseKML(kml, origin);
    expect(areas).toHaveLength(2);
    expectSameOutline(areas[0], MAP.areas[0]);
    expect(areas[0].properties.name).toBe("Front & back");
    expect(areas[0].properties.outline_count).toBe(2);
    expect(areas[1].properties.type).toBe("obstacle");
    expect(dock.heading).toBeCloseTo(0.5);
  });

  it("parses a plain Google Earth polygon with the default type", () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Lawn</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
      8.2,52.1,0 8.2001,52.1,0 8.2001,52.1001,0 8.2,52.1,0
    </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    const { areas } = parseKML(kml, origin, "mow");
    expect(areas).toHaveLength(1);
    expect(areas[0].points).toHaveLength(3);
    expect(areas[0].properties).toEqual({ type: "mow", name: "Lawn" });
  });

  it("detects the format from name or content", () => {
    expect(detectExchangeFormat("a.kml", "")).toBe("kml");
    expect(detectExchangeFormat("a.txt", "<?xml version='1.0'?><kml>")).toBe("kml");
    expect(detectExchangeFormat("a.geojson", "{}")).toBe("geojson");
  });
});
