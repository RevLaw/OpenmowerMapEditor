// Equirectangular (flat-earth) projection around a datum origin.
// Ported verbatim from the original app.js so existing maps round-trip
// identically. Valid only for small local areas (the OpenMower use case).

const METERS_PER_DEG_LAT = 111320;

/**
 * Convert local metric coordinates to [lat, lng].
 * @param {{x:number,y:number}} point  meters in the robot/map frame
 * @param {{lat:number,lng:number}} origin  datum origin
 * @returns {[number, number]} [lat, lng]
 */
export function metersToLatLng(point, origin) {
  const lat = origin.lat + point.y / METERS_PER_DEG_LAT;
  const lng =
    origin.lng +
    point.x / (METERS_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180));
  return [lat, lng];
}

/**
 * Convert [lat, lng] back to local metric coordinates.
 * @param {{lat:number,lng:number}} latlng
 * @param {{lat:number,lng:number}} origin  datum origin
 * @returns {{x:number,y:number}}
 */
export function latLngToMeters(latlng, origin) {
  const x =
    (latlng.lng - origin.lng) *
    (METERS_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180));
  const y = (latlng.lat - origin.lat) * METERS_PER_DEG_LAT;
  return { x, y };
}
