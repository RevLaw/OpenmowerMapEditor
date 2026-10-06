// GeoJSON / KML exchange: export the map's zones + dock as WGS84 geometry
// (for QGIS, Google Earth, geojson.io, off-robot backups) and import polygons
// back into local map meters. Pure string/object transforms — KML is parsed
// with regexes rather than DOMParser so this stays runnable in plain Node.
import { metersToLatLng, latLngToMeters } from "../geo/projection.js";
import { getEditablePoints } from "./outline.js";
import { getAreaType, ZONE_OVERRIDE_KEYS } from "./mapFormat.js";

export const ZONE_TYPES = ["mow", "obstacle", "nav"];
const DOCK_TYPES = new Set(["dock", "docking_station"]);
const COORD_DIGITS = 8; // ~1 mm at the equator

const round = (v) => Number(v.toFixed(COORD_DIGITS));

function toLngLat(p, origin) {
  const [lat, lng] = metersToLatLng(p, origin);
  return [round(lng), round(lat)];
}

function toMeters([lng, lat], origin) {
  return latLngToMeters({ lat, lng }, origin);
}

/** Zone properties worth carrying across: type, name, id and mowing overrides. */
function exportProps(area) {
  const props = { type: getAreaType(area) };
  const p = area.properties || {};
  if (typeof p.name === "string" && p.name.trim()) props.name = p.name.trim();
  if (area.id) props.id = area.id;
  for (const key of ZONE_OVERRIDE_KEYS) {
    if (typeof p[key] === "number" && Number.isFinite(p[key])) props[key] = p[key];
  }
  return props;
}

/** Map → GeoJSON FeatureCollection (Polygons for zones, a Point for the dock). */
export function mapToGeoJSON(map, origin) {
  const features = [];
  for (const area of map?.areas || []) {
    const pts = getEditablePoints(area.outline || []);
    if (pts.length < 3) continue;
    const ring = pts.map((p) => toLngLat(p, origin));
    ring.push(ring[0]);
    features.push({
      type: "Feature",
      properties: exportProps(area),
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  const dock = map?.docking_stations?.[0];
  if (dock?.position) {
    const props = { type: "dock" };
    if (Number.isFinite(dock.heading)) props.heading = dock.heading;
    features.push({
      type: "Feature",
      properties: props,
      geometry: { type: "Point", coordinates: toLngLat(dock.position, origin) },
    });
  }
  return { type: "FeatureCollection", features };
}

function normalizeType(raw, fallback) {
  const t = String(raw || "").toLowerCase();
  if (ZONE_TYPES.includes(t)) return t;
  if (t === "navigation") return "nav";
  return fallback;
}

/** Build an imported area from a lng/lat ring plus loose properties. */
function importArea(ring, props, origin, defaultType) {
  let pts = ring.map((c) => toMeters(c, origin));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return null;
  const properties = { type: normalizeType(props.type, defaultType) };
  if (typeof props.name === "string" && props.name.trim()) properties.name = props.name.trim();
  for (const key of ZONE_OVERRIDE_KEYS) {
    const v = Number(props[key]);
    if (props[key] != null && props[key] !== "" && Number.isFinite(v)) properties[key] = v;
  }
  return { id: typeof props.id === "string" && props.id ? props.id : null, properties, points: pts };
}

function validCoord(c) {
  return Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
}

/**
 * GeoJSON (FeatureCollection / Feature / bare geometry) → importable zones.
 * Polygons and MultiPolygons become zones (outer rings only); a Point whose
 * `type` property is "dock" becomes the docking station.
 * @returns {{areas:Array<{id:string|null, properties:object, points:Array}>, dock:{position:{x,y}, heading?:number}|null, skipped:number}}
 */
export function parseGeoJSON(input, origin, defaultType = "mow") {
  const obj = typeof input === "string" ? JSON.parse(input) : input;
  const features =
    obj?.type === "FeatureCollection"
      ? obj.features || []
      : obj?.type === "Feature"
        ? [obj]
        : obj?.type
          ? [{ type: "Feature", properties: {}, geometry: obj }]
          : [];
  if (!features.length && obj?.type !== "FeatureCollection") {
    throw new Error("Not a GeoJSON document.");
  }
  const areas = [];
  let dock = null;
  let skipped = 0;
  const addRing = (ring, props) => {
    if (!Array.isArray(ring) || !ring.every(validCoord)) {
      skipped += 1;
      return;
    }
    const area = importArea(ring.map((c) => [Number(c[0]), Number(c[1])]), props, origin, defaultType);
    if (area) areas.push(area);
    else skipped += 1;
  };
  for (const f of features) {
    const g = f?.geometry;
    const props = f?.properties || {};
    if (!g) {
      skipped += 1;
      continue;
    }
    if (g.type === "Polygon") addRing(g.coordinates?.[0], props);
    else if (g.type === "MultiPolygon") (g.coordinates || []).forEach((poly) => addRing(poly?.[0], props));
    else if (g.type === "LineString") addRing(g.coordinates, props);
    else if (g.type === "Point" && DOCK_TYPES.has(String(props.type || "").toLowerCase()) && validCoord(g.coordinates)) {
      dock = { position: toMeters(g.coordinates.map(Number), origin) };
      const heading = Number(props.heading);
      if (props.heading != null && Number.isFinite(heading)) dock.heading = heading;
    } else skipped += 1;
  }
  return { areas, dock, skipped };
}

// ---- KML -------------------------------------------------------------------

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// KML colors are aabbggrr.
const KML_STYLES = {
  mow: { line: "ffffffff", poly: "3322c55e" },
  obstacle: { line: "ff4444ef", poly: "554444ef" },
  nav: { line: "fff8bd38", poly: "33f8bd38" },
};

function extendedData(props) {
  const rows = Object.entries(props)
    .filter(([k]) => k !== "name")
    .map(([k, v]) => `<Data name="${escapeXml(k)}"><value>${escapeXml(v)}</value></Data>`);
  return rows.length ? `<ExtendedData>${rows.join("")}</ExtendedData>` : "";
}

/** Map → KML document string. */
export function mapToKML(map, origin, docName = "OpenMower map") {
  const styles = Object.entries(KML_STYLES)
    .map(
      ([type, s]) =>
        `<Style id="${type}"><LineStyle><color>${s.line}</color><width>2</width></LineStyle><PolyStyle><color>${s.poly}</color></PolyStyle></Style>`
    )
    .join("\n    ");
  const placemarks = [];
  (map?.areas || []).forEach((area, i) => {
    const pts = getEditablePoints(area.outline || []);
    if (pts.length < 3) return;
    const props = exportProps(area);
    const coords = [...pts, pts[0]].map((p) => toLngLat(p, origin).join(",")).join(" ");
    placemarks.push(
      `<Placemark><name>${escapeXml(props.name || `${props.type} ${i + 1}`)}</name><styleUrl>#${props.type}</styleUrl>${extendedData(props)}<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    );
  });
  const dock = map?.docking_stations?.[0];
  if (dock?.position) {
    const props = { type: "dock" };
    if (Number.isFinite(dock.heading)) props.heading = dock.heading;
    placemarks.push(
      `<Placemark><name>Docking station</name>${extendedData(props)}<Point><coordinates>${toLngLat(dock.position, origin).join(",")}</coordinates></Point></Placemark>`
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(docName)}</name>
    ${styles}
    ${placemarks.join("\n    ")}
  </Document>
</kml>
`;
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return m ? m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1").trim() : null;
}

function parseKmlCoords(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(",").map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => [c[0], c[1]]);
}

/** KML text → importable zones (same result shape as parseGeoJSON). */
export function parseKML(text, origin, defaultType = "mow") {
  if (!/<kml[\s>]/i.test(text)) throw new Error("Not a KML document.");
  const areas = [];
  let dock = null;
  let skipped = 0;
  const placemarks = text.match(/<(?:\w+:)?Placemark\b[\s\S]*?<\/(?:\w+:)?Placemark>/gi) || [];
  for (const pm of placemarks) {
    const props = {};
    const name = tagText(pm, "name");
    if (name) props.name = unescapeXml(name);
    for (const m of pm.matchAll(/<Data\s+name="([^"]+)"\s*>\s*<value>([\s\S]*?)<\/value>\s*<\/Data>/gi)) {
      props[unescapeXml(m[1])] = unescapeXml(m[2].trim());
    }
    // Style ids from our own export double as the zone type.
    const styleUrl = tagText(pm, "styleUrl");
    if (!props.type && styleUrl) props.type = styleUrl.replace(/^#/, "");

    const outers = pm.match(/<(?:\w+:)?outerBoundaryIs\b[\s\S]*?<\/(?:\w+:)?outerBoundaryIs>/gi) || [];
    if (outers.length) {
      for (const outer of outers) {
        const coords = tagText(outer, "coordinates");
        const area = coords ? importArea(parseKmlCoords(coords), props, origin, defaultType) : null;
        if (area) areas.push(area);
        else skipped += 1;
      }
      continue;
    }
    const point = pm.match(/<(?:\w+:)?Point\b[\s\S]*?<\/(?:\w+:)?Point>/i);
    if (point && DOCK_TYPES.has(String(props.type || "").toLowerCase())) {
      const c = parseKmlCoords(tagText(point[0], "coordinates") || "")[0];
      if (c) {
        dock = { position: toMeters(c, origin) };
        const heading = Number(props.heading);
        if (props.heading != null && Number.isFinite(heading)) dock.heading = heading;
        continue;
      }
    }
    const line = pm.match(/<(?:\w+:)?LineString\b[\s\S]*?<\/(?:\w+:)?LineString>/i);
    const area = line ? importArea(parseKmlCoords(tagText(line[0], "coordinates") || ""), props, origin, defaultType) : null;
    if (area) areas.push(area);
    else skipped += 1;
  }
  return { areas, dock, skipped };
}

/** Pick a parser from the file name / content. */
export function detectExchangeFormat(fileName, text) {
  const name = String(fileName || "").toLowerCase();
  if (name.endsWith(".kml") || /^\s*<\?xml|<kml[\s>]/i.test(text.slice(0, 500))) return "kml";
  return "geojson";
}
