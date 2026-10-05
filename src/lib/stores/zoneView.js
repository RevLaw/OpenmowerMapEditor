import { writable, derived, get } from "svelte/store";
import { editor } from "./editor.js";

// Editor-only per-zone view state: hidden zones aren't drawn on the map,
// locked zones can be selected but not edited. Never written to map.json —
// persisted per browser, keyed by zone id (list position for id-less zones).
const HIDDEN_KEY = "om-zones-hidden";
const LOCKED_KEY = "om-zones-locked";

function load(key) {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch (_e) {
    return new Set();
  }
}

function persistedSet(key) {
  const store = writable(load(key));
  store.subscribe((set) => {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify([...set]));
    } catch (_e) {
      /* storage full / blocked — view state is a convenience only */
    }
  });
  return store;
}

export const hiddenZones = persistedSet(HIDDEN_KEY);
export const lockedZones = persistedSet(LOCKED_KEY);

/** Stable view-state key for a zone. */
export function zoneKey(area, index) {
  return area?.id ? `id:${area.id}` : `idx:${index}`;
}

function toggleIn(store, key) {
  store.update((set) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

export function toggleZoneHidden(area, index) {
  toggleIn(hiddenZones, zoneKey(area, index));
}

export function toggleZoneLocked(area, index) {
  toggleIn(lockedZones, zoneKey(area, index));
}

export function isZoneHidden(area, index) {
  return get(hiddenZones).has(zoneKey(area, index));
}

export function isZoneLocked(area, index) {
  return get(lockedZones).has(zoneKey(area, index));
}

/** Show every zone again. */
export function showAllZones() {
  hiddenZones.set(new Set());
}

/** Is the currently selected zone locked? */
export const currentLocked = derived([editor, lockedZones], ([$e, $locked]) => {
  const area = $e.mapData?.areas?.[$e.areaIndex];
  return Boolean(area && $locked.has(zoneKey(area, $e.areaIndex)));
});
