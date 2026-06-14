import { describe, it, expect } from "vitest";
import { metersToLatLng, latLngToMeters } from "./projection.js";

const origin = { lat: 52.52, lng: 13.405 };

describe("projection", () => {
  it("maps the origin to (0,0)", () => {
    const [lat, lng] = metersToLatLng({ x: 0, y: 0 }, origin);
    expect(lat).toBeCloseTo(origin.lat, 12);
    expect(lng).toBeCloseTo(origin.lng, 12);
  });

  it("moves 1 degree of latitude per 111320 m north", () => {
    const [lat] = metersToLatLng({ x: 0, y: 111320 }, origin);
    expect(lat).toBeCloseTo(origin.lat + 1, 9);
  });

  it("round-trips meters -> latlng -> meters", () => {
    const point = { x: 12.34, y: -56.78 };
    const [lat, lng] = metersToLatLng(point, origin);
    const back = latLngToMeters({ lat, lng }, origin);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });
});
