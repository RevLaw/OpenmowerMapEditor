import { writable, derived, get } from "svelte/store";
import {
  cloneMap,
  parseMap,
  readEditorMeta,
  writeEditorMeta,
  getAreaType,
  generateZoneId,
  createDefaultZoneOutline,
} from "../format/mapFormat.js";
import { getEditablePoints, closeLoop } from "../format/outline.js";
import { dragBrush } from "../geo/tools/brush.js";
import { snapEvenly } from "../geo/tools/snap.js";
import { simplify } from "../geo/geometry.js";

const DEFAULT_ORIGIN = { lat: 52.52, lng: 13.405 };
const HISTORY_LIMIT = 100;

function blank() {
  return {
    mapData: null,
    areaIndex: 0,
    pointIndex: null,
    selectedPointIndices: [],
    snapPointIndices: [],
    origin: { ...DEFAULT_ORIGIN },
    // bumped on every structural change to trigger non-deep re-renders
    rev: 0,
  };
}

const store = writable(blank());
const undoStack = [];
const redoStack = [];
export const history = writable({ canUndo: false, canRedo: false });

function emitHistory() {
  history.set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
}

function snapshot(s) {
  return {
    mapData: cloneMap(s.mapData),
    areaIndex: s.areaIndex,
    pointIndex: s.pointIndex,
    origin: { ...s.origin },
  };
}

/** Push a history entry from the current state (call BEFORE mutating). */
export function pushHistory() {
  const s = get(store);
  if (!s.mapData) return;
  undoStack.push(snapshot(s));
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  emitHistory();
}

function restore(snap, s) {
  return {
    ...s,
    mapData: cloneMap(snap.mapData),
    areaIndex: snap.areaIndex,
    pointIndex: snap.pointIndex,
    origin: { ...snap.origin },
    selectedPointIndices: [],
    snapPointIndices: [],
    rev: s.rev + 1,
  };
}

// ---- derived helpers -------------------------------------------------------

export const currentArea = derived(store, ($s) => {
  if (!$s.mapData?.areas?.length) return null;
  return $s.mapData.areas[$s.areaIndex] || null;
});

export const areaList = derived(store, ($s) =>
  ($s.mapData?.areas || []).map((area, i) => ({
    index: i,
    id: area.id,
    type: getAreaType(area),
    name: area.properties?.name?.trim() || "",
  }))
);

/** Editable points (open) of the current area. */
export function currentEditablePoints() {
  const s = get(store);
  const area = s.mapData?.areas?.[s.areaIndex];
  return area ? getEditablePoints(area.outline || []) : [];
}

function setCurrentEditable(points, s) {
  const area = s.mapData.areas[s.areaIndex];
  area.outline = closeLoop(points);
}

// ---- mutating actions ------------------------------------------------------

export function loadMap(source) {
  const map = typeof source === "string" ? parseMap(source) : source;
  store.update((s) => {
    const meta = readEditorMeta(map);
    const origin = meta || { ...s.origin };
    writeEditorMeta(map, origin);
    undoStack.length = 0;
    redoStack.length = 0;
    emitHistory();
    return {
      ...blank(),
      mapData: map,
      origin,
      rev: s.rev + 1,
    };
  });
}

export function setZoneType(type) {
  store.update((s) => {
    const a = s.mapData?.areas?.[s.areaIndex];
    if (!a) return s;
    a.properties = { ...(a.properties || {}), type };
    return { ...s, rev: s.rev + 1 };
  });
}

/**
 * Set (or clear, when value == null) a per-area mowing override on the current
 * zone. `rosKey` is the map.json properties key (outline_count, angle, …).
 */
export function writeZoneOverride(rosKey, value) {
  store.update((s) => {
    const a = s.mapData?.areas?.[s.areaIndex];
    if (!a) return s;
    if (!a.properties) a.properties = {};
    if (value == null || Number.isNaN(value)) delete a.properties[rosKey];
    else a.properties[rosKey] = value;
    return { ...s, rev: s.rev + 1 };
  });
}

/** Set a friendly name on the current zone (stored in properties.name). */
export function setZoneName(name) {
  store.update((s) => {
    const a = s.mapData?.areas?.[s.areaIndex];
    if (!a) return s;
    if (!a.properties) a.properties = {};
    const clean = (name || "").trim();
    if (clean) a.properties.name = clean;
    else delete a.properties.name;
    return { ...s, rev: s.rev + 1 };
  });
}

/** Move the selected zone earlier/later in the list (dir = -1 or +1). */
export function reorderZone(dir) {
  store.update((s) => {
    const areas = s.mapData?.areas;
    if (!areas) return s;
    const i = s.areaIndex;
    const j = i + dir;
    if (j < 0 || j >= areas.length) return s;
    [areas[i], areas[j]] = [areas[j], areas[i]];
    return { ...s, areaIndex: j, rev: s.rev + 1 };
  });
}

export function setAreaIndex(index) {
  store.update((s) => ({
    ...s,
    areaIndex: index,
    pointIndex: null,
    selectedPointIndices: [],
    snapPointIndices: [],
  }));
}

export function selectPoint(idx) {
  store.update((s) => ({ ...s, pointIndex: idx, selectedPointIndices: [], snapPointIndices: [] }));
}

export function clearSelection() {
  store.update((s) => ({
    ...s,
    pointIndex: null,
    selectedPointIndices: [],
    snapPointIndices: [],
  }));
}

/** Add / remove a point from the multi-selection (a single selected point joins it). */
export function toggleMultiPoint(idx) {
  store.update((s) => {
    const set = new Set(s.selectedPointIndices);
    if (s.pointIndex != null) set.add(s.pointIndex);
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    return { ...s, pointIndex: null, selectedPointIndices: [...set].sort((a, b) => a - b) };
  });
}

export function setMultiSelection(indices) {
  store.update((s) => ({ ...s, pointIndex: null, selectedPointIndices: [...indices] }));
}

/** Select every vertex of the current zone (then drag / nudge / delete them together). */
export function selectAllPoints() {
  const n = currentEditablePoints().length;
  setMultiSelection(Array.from({ length: n }, (_, i) => i));
  return n;
}

/** Move a single vertex to new metric coordinates. */
export function movePoint(idx, meters) {
  store.update((s) => {
    if (!s.mapData) return s;
    const pts = currentEditablePoints();
    if (idx < 0 || idx >= pts.length) return s;
    pts[idx] = { x: meters.x, y: meters.y };
    setCurrentEditable(pts, s);
    return { ...s, pointIndex: idx, rev: s.rev + 1 };
  });
}

/** Translate a set of selected vertices by (dx,dy). */
export function movePointsBy(indices, dx, dy, original) {
  store.update((s) => {
    if (!s.mapData) return s;
    const pts = currentEditablePoints();
    for (let i = 0; i < indices.length; i += 1) {
      const idx = indices[i];
      const base = original ? original[i] : pts[idx];
      pts[idx] = { x: base.x + dx, y: base.y + dy };
    }
    setCurrentEditable(pts, s);
    return { ...s, rev: s.rev + 1 };
  });
}

export function addZone(type, centerMeters) {
  store.update((s) => {
    if (!s.mapData) return s;
    if (!Array.isArray(s.mapData.areas)) s.mapData.areas = [];
    s.mapData.areas.push({
      id: generateZoneId(),
      properties: { type },
      outline: createDefaultZoneOutline(centerMeters),
    });
    return {
      ...s,
      areaIndex: s.mapData.areas.length - 1,
      pointIndex: 0,
      selectedPointIndices: [],
      rev: s.rev + 1,
    };
  });
}

export function removeZone() {
  store.update((s) => {
    if (!s.mapData?.areas?.length) return s;
    s.mapData.areas.splice(s.areaIndex, 1);
    const areaIndex = Math.max(0, Math.min(s.areaIndex, s.mapData.areas.length - 1));
    return {
      ...s,
      areaIndex,
      pointIndex: null,
      selectedPointIndices: [],
      rev: s.rev + 1,
    };
  });
}

/** Apply one drag-brush step (history is pushed once at stroke start). */
export function applyBrush(centerMeters, deltaMeters, radius, strength) {
  return applyBrushSteps([{ center: centerMeters, delta: deltaMeters }], radius, strength);
}

/**
 * Apply several brush steps in order with a single store update — the map
 * batches a frame's worth of pointer moves into one call. Same result as
 * applying them one by one.
 */
export function applyBrushSteps(steps, radius, strength) {
  let moved = 0;
  store.update((s) => {
    if (!s.mapData?.areas?.[s.areaIndex] || !steps.length) return s;
    let pts = currentEditablePoints();
    for (const step of steps) {
      const result = dragBrush(pts, step.center, step.delta, radius, strength);
      moved += result.moved;
      pts = result.points;
    }
    if (!moved) return s;
    setCurrentEditable(pts, s);
    return { ...s, rev: s.rev + 1 };
  });
  return moved;
}

export function snapBetween(startIdx, endIdx) {
  let changed = 0;
  store.update((s) => {
    if (!s.mapData) return s;
    const pts = currentEditablePoints();
    const result = snapEvenly(pts, startIdx, endIdx);
    changed = result.changed;
    if (!changed) return s;
    setCurrentEditable(result.points, s);
    return { ...s, snapPointIndices: [], rev: s.rev + 1 };
  });
  return changed;
}

export function setSnapPoints(indices) {
  store.update((s) => ({ ...s, snapPointIndices: [...indices] }));
}

export function moveDock(meters) {
  store.update((s) => {
    const station = s.mapData?.docking_stations?.[0];
    if (!station?.position) return s;
    station.position.x = meters.x;
    station.position.y = meters.y;
    return { ...s, rev: s.rev + 1 };
  });
}

export function applyProjection(lat, lng) {
  store.update((s) => {
    const origin = { lat, lng };
    if (s.mapData) writeEditorMeta(s.mapData, origin);
    return { ...s, origin, rev: s.rev + 1 };
  });
}

export function setOrigin(origin) {
  store.update((s) => ({ ...s, origin: { ...origin } }));
}

/** Insert a vertex at an explicit editable index (used by smart edge-add). */
export function insertPointAtIndex(index, meters) {
  store.update((s) => {
    if (!s.mapData?.areas?.[s.areaIndex]) return s;
    const pts = currentEditablePoints();
    const at = Math.max(0, Math.min(index, pts.length));
    pts.splice(at, 0, { x: meters.x, y: meters.y });
    setCurrentEditable(pts, s);
    return { ...s, pointIndex: at, rev: s.rev + 1 };
  });
}

/** Remove all multi-selected points (or the single selection). Keeps >= 3. */
export function deleteSelectedPoints() {
  let removed = 0;
  store.update((s) => {
    if (!s.mapData) return s;
    const pts = currentEditablePoints();
    const targets = s.selectedPointIndices.length
      ? [...s.selectedPointIndices]
      : s.pointIndex != null
        ? [s.pointIndex]
        : [];
    if (!targets.length) return s;
    if (pts.length - targets.length < 3) return s;
    const drop = new Set(targets);
    const kept = pts.filter((_, i) => !drop.has(i));
    removed = pts.length - kept.length;
    setCurrentEditable(kept, s);
    return { ...s, pointIndex: null, selectedPointIndices: [], rev: s.rev + 1 };
  });
  return removed;
}

/** Nudge the current selection (single or multi) by a metric delta. */
export function nudgeSelection(dx, dy) {
  let moved = false;
  store.update((s) => {
    if (!s.mapData) return s;
    const pts = currentEditablePoints();
    const targets = s.selectedPointIndices.length
      ? s.selectedPointIndices
      : s.pointIndex != null
        ? [s.pointIndex]
        : [];
    if (!targets.length) return s;
    targets.forEach((i) => {
      if (pts[i]) {
        pts[i] = { x: pts[i].x + dx, y: pts[i].y + dy };
      }
    });
    setCurrentEditable(pts, s);
    moved = true;
    return { ...s, rev: s.rev + 1 };
  });
  return moved;
}

/** Simplify the current zone outline (Douglas–Peucker, tolerance in m). */
export function simplifyZone(tolerance) {
  let removed = 0;
  store.update((s) => {
    if (!s.mapData?.areas?.[s.areaIndex]) return s;
    const pts = currentEditablePoints();
    const next = simplify(pts, tolerance);
    removed = pts.length - next.length;
    if (removed <= 0) return s;
    setCurrentEditable(next, s);
    return { ...s, pointIndex: null, rev: s.rev + 1 };
  });
  return removed;
}

/** Duplicate the selected zone, offset so the copy is visible, and select it. */
export function duplicateZone(offset = { x: 0.5, y: 0.5 }) {
  store.update((s) => {
    const area = s.mapData?.areas?.[s.areaIndex];
    if (!area) return s;
    const copy = cloneMap(area);
    copy.id = generateZoneId();
    copy.outline = (area.outline || []).map((p) => ({
      x: p.x + offset.x,
      y: p.y + offset.y,
    }));
    s.mapData.areas.push(copy);
    return {
      ...s,
      areaIndex: s.mapData.areas.length - 1,
      pointIndex: null,
      selectedPointIndices: [],
      rev: s.rev + 1,
    };
  });
}

/** Add a new zone from an open editable-point array (draw tools, recording, import). */
export function addZoneFromPoints(type, points, extraProps = {}) {
  store.update((s) => {
    if (!s.mapData) return s;
    if (!Array.isArray(s.mapData.areas)) s.mapData.areas = [];
    s.mapData.areas.push({
      id: generateZoneId(),
      properties: { ...extraProps, type },
      outline: closeLoop(points),
    });
    return {
      ...s,
      areaIndex: s.mapData.areas.length - 1,
      pointIndex: null,
      selectedPointIndices: [],
      rev: s.rev + 1,
    };
  });
}

/**
 * Place / move the docking station (creating the array if needed). `heading`
 * (radians, map frame, 0 = east) is only written when given.
 */
export function setDock(meters, heading) {
  store.update((s) => {
    if (!s.mapData) return s;
    if (!Array.isArray(s.mapData.docking_stations) || !s.mapData.docking_stations.length) {
      s.mapData.docking_stations = [{ id: generateZoneId(), properties: {}, position: { x: meters.x, y: meters.y } }];
    } else {
      const st = s.mapData.docking_stations[0];
      st.position = { x: meters.x, y: meters.y };
    }
    if (Number.isFinite(heading)) s.mapData.docking_stations[0].heading = heading;
    return { ...s, rev: s.rev + 1 };
  });
}

/** Set the docking station heading (radians, map frame, 0 = east). */
export function setDockHeading(heading) {
  store.update((s) => {
    const st = s.mapData?.docking_stations?.[0];
    if (!st?.position || !Number.isFinite(heading)) return s;
    st.heading = Math.atan2(Math.sin(heading), Math.cos(heading)); // wrap to (-π, π]
    return { ...s, rev: s.rev + 1 };
  });
}

/** Remove the docking station entirely. */
export function removeDock() {
  store.update((s) => {
    if (!s.mapData?.docking_stations?.length) return s;
    s.mapData.docking_stations = [];
    return { ...s, rev: s.rev + 1 };
  });
}

/**
 * Replace the whole zone list in one step (boolean ops, import) and select
 * `areaIndex`. `areas` must already be valid map.json area objects.
 */
export function replaceAreas(areas, areaIndex = 0) {
  store.update((s) => {
    if (!s.mapData) return s;
    s.mapData.areas = areas;
    return {
      ...s,
      areaIndex: Math.max(0, Math.min(areaIndex, areas.length - 1)),
      pointIndex: null,
      selectedPointIndices: [],
      snapPointIndices: [],
      rev: s.rev + 1,
    };
  });
}

/** Make vertex `idx` the outline's first point (OpenMower starts the auto mow angle there). */
export function setStartPoint(idx) {
  store.update((s) => {
    if (!s.mapData?.areas?.[s.areaIndex]) return s;
    const pts = currentEditablePoints();
    if (idx <= 0 || idx >= pts.length) return s;
    setCurrentEditable([...pts.slice(idx), ...pts.slice(0, idx)], s);
    return { ...s, pointIndex: 0, selectedPointIndices: [], rev: s.rev + 1 };
  });
}

export function undo() {
  if (!undoStack.length) return false;
  store.update((s) => {
    redoStack.push(snapshot(s));
    const snap = undoStack.pop();
    return restore(snap, s);
  });
  emitHistory();
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  store.update((s) => {
    undoStack.push(snapshot(s));
    const snap = redoStack.pop();
    return restore(snap, s);
  });
  emitHistory();
  return true;
}

export { store as editor };
