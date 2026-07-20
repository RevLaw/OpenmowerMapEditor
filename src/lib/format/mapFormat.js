// Map-level parsing, metadata, and serialization for the OpenMower map.json
// format: { areas:[{id, properties:{type}, outline:[{x,y}]}],
//           docking_stations:[{position:{x,y}}], __editor:{originLat,originLng} }

export const EDITOR_META_KEY = "__editor";

/** Parse map JSON text, throwing on a structurally invalid document. */
export function parseMap(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.areas)) {
    throw new Error("Invalid map format: missing areas array.");
  }
  return parsed;
}

/** Read the editor origin metadata, or null when absent/invalid. */
export function readEditorMeta(map) {
  const meta = map?.[EDITOR_META_KEY];
  if (meta && Number.isFinite(meta.originLat) && Number.isFinite(meta.originLng)) {
    return { lat: meta.originLat, lng: meta.originLng };
  }
  return null;
}

/** Persist the editor origin metadata onto the map (mutates and returns it). */
export function writeEditorMeta(map, origin) {
  if (!map) return map;
  map[EDITOR_META_KEY] = { originLat: origin.lat, originLng: origin.lng };
  return map;
}

/** An area's zone type, defaulting to the generic "area". */
export function getAreaType(area) {
  return area?.properties?.type || "area";
}

// Per-area mowing overrides (OpenMower v1.2) live in area.properties. A key
// that's absent means "use the global default" (angle absent = auto-detect).
// `angle` is stored in RADIANS, as OpenMower reads it.
export const ZONE_OVERRIDE_KEYS = [
  "outline_count",
  "outline_overlap_count",
  "outline_offset",
  "angle",
];

/** Read a zone's overrides as numbers, or null when unset. */
export function getZoneOverrides(area) {
  const p = area?.properties || {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    outlineCount: num(p.outline_count),
    outlineOverlapCount: num(p.outline_overlap_count),
    outlineOffset: num(p.outline_offset),
    angle: num(p.angle), // radians
  };
}

/** Friendly zone label: properties.name if set, else "<type> <n>". */
export function getZoneName(area, index = 0) {
  const n = area?.properties?.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  return `${getAreaType(area)} ${index + 1}`;
}

/** Generate a reasonably unique zone id (matches app.js scheme). */
export function generateZoneId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Default square outline (closed ring) centered on a metric point. */
export function createDefaultZoneOutline(center, halfSizeMeters = 0.8) {
  return [
    { x: center.x - halfSizeMeters, y: center.y - halfSizeMeters },
    { x: center.x + halfSizeMeters, y: center.y - halfSizeMeters },
    { x: center.x + halfSizeMeters, y: center.y + halfSizeMeters },
    { x: center.x - halfSizeMeters, y: center.y + halfSizeMeters },
    { x: center.x - halfSizeMeters, y: center.y - halfSizeMeters },
  ];
}

/** Serialize the map exactly as the server writes it (2-space indent). */
export function serializeMap(map) {
  return JSON.stringify(map, null, 2);
}

/** Deep clone via structured JSON (map data is plain JSON). */
export function cloneMap(map) {
  return JSON.parse(JSON.stringify(map));
}
