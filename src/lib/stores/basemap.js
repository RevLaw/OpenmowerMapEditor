import { writable, derived } from "svelte/store";

// Selectable base layers. All sources below were verified reachable and
// keyless. `type` is "xyz" (slippy tiles) or "wms".
export const BASEMAPS = [
  {
    id: "esri",
    label: "Satellite — Esri",
    note: "Global, native to z20",
    type: "xyz",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 20,
    maxZoom: 24,
    attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics",
  },
  {
    id: "ni-dop20",
    label: "Aerial 20 cm — Lower Saxony (DE)",
    note: "True 20 cm; smooth when zoomed in",
    type: "wms",
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms",
    layers: "ni_dop20",
    // 20 cm imagery is native at ~z19. Render there (full detail, no server
    // upscale) and let the browser interpolate beyond — soft, not blocky.
    maxNativeZoom: 19,
    maxZoom: 24,
    attribution: "&copy; GeoBasis-DE / LGLN (DOP20)",
  },
  {
    id: "osm",
    label: "Streets — OpenStreetMap",
    note: "Global fallback where aerial is missing",
    type: "xyz",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
    maxZoom: 24,
    attribution: "&copy; OpenStreetMap contributors",
  },
];

const ID_KEY = "openmower-map-editor-basemap";
const CUSTOM_KEY = "openmower-map-editor-basemap-custom";

function load(key, fallback) {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return key === CUSTOM_KEY ? JSON.parse(raw) : raw;
  } catch (_e) {
    return fallback;
  }
}

const VALID_IDS = new Set([...BASEMAPS.map((b) => b.id), "custom"]);
const savedId = load(ID_KEY, "esri");
export const basemapId = writable(VALID_IDS.has(savedId) ? savedId : "esri");
export const customBasemap = writable(
  load(CUSTOM_KEY, { type: "xyz", url: "", layers: "", attribution: "Custom layer" })
);

basemapId.subscribe((v) => {
  if (typeof localStorage !== "undefined") localStorage.setItem(ID_KEY, v);
});
customBasemap.subscribe((v) => {
  if (typeof localStorage !== "undefined") localStorage.setItem(CUSTOM_KEY, JSON.stringify(v));
});

function normalizeCustom(c) {
  if (!c || !c.url || !/^https?:\/\//.test(c.url)) {
    return BASEMAPS[0]; // fall back to Esri until a valid URL is entered
  }
  const isWms = c.type === "wms";
  return {
    id: "custom",
    label: "Custom",
    type: isWms ? "wms" : "xyz",
    url: c.url,
    layers: c.layers || "",
    // WMS renders fresh at any scale; XYZ has a tile pyramid that may run out.
    maxNativeZoom: isWms ? 22 : 21,
    maxZoom: 24,
    attribution: c.attribution || "Custom layer",
  };
}

/** The resolved config for the currently selected base layer. */
export const activeBasemap = derived([basemapId, customBasemap], ([$id, $custom]) => {
  if ($id === "custom") return normalizeCustom($custom);
  return BASEMAPS.find((b) => b.id === $id) || BASEMAPS[0];
});
