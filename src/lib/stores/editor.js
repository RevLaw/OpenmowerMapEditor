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
import {
  centroid,
  translatePoints,
  rotatePoints,
  scalePoints,
  simplify,
} from "../geo/geometry.js";

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

export function renameZone(id) {
  store.update((s) => {
    const a = s.mapData?.areas?.[s.areaIndex];
    if (!a) return s;
    a.id = id;
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
  store.update((s) => ({ ...s, pointIndex: idx, snapPointIndices: [] }));
}

export function clearSelection() {
  store.update((s) => ({
    ...s,
    pointIndex: null,
    selectedPointIndices: [],
    snapPointIndices: [],
  }));
}

export function toggleMultiPoint(idx) {
  store.update((s) => {
    const set = new Set(s.selectedPointIndices);
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    return { ...s, selectedPointIndices: [...set].sort((a, b) => a - b) };
  });
}

export function setMultiSelection(indices) {
  store.update((s) => ({ ...s, selectedPointIndices: [...indices] }));
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
  let moved = 0;
  store.update((s) => {
    if (!s.mapData) return s;
    const pts = currentEditablePoints();
    const result = dragBrush(pts, centerMeters, deltaMeters, radius, strength);
    moved = result.moved;
    if (!moved) return s;
    setCurrentEditable(result.points, s);
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

/** Translate every vertex of the current zone. */
export function translateZone(dx, dy) {
  store.update((s) => {
    if (!s.mapData?.areas?.[s.areaIndex]) return s;
    setCurrentEditable(translatePoints(currentEditablePoints(), dx, dy), s);
    return { ...s, rev: s.rev + 1 };
  });
}

/** Rotate (radians) or scale (factor) the current zone about its centroid. */
export function transformZone(kind, amount) {
  store.update((s) => {
    if (!s.mapData?.areas?.[s.areaIndex]) return s;
    const pts = currentEditablePoints();
    const c = centroid(pts);
    if (!c) return s;
    const next = kind === "rotate" ? rotatePoints(pts, c, amount) : scalePoints(pts, c, amount);
    setCurrentEditable(next, s);
    return { ...s, rev: s.rev + 1 };
  });
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

/** Add a new zone from an open editable-point array (rectangle / circle draw). */
export function addZoneFromPoints(type, points) {
  store.update((s) => {
    if (!s.mapData) return s;
    if (!Array.isArray(s.mapData.areas)) s.mapData.areas = [];
    s.mapData.areas.push({
      id: generateZoneId(),
      properties: { type },
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

/** Place / move the docking station (creating the array if needed). */
export function setDock(meters) {
  store.update((s) => {
    if (!s.mapData) return s;
    if (!Array.isArray(s.mapData.docking_stations) || !s.mapData.docking_stations.length) {
      s.mapData.docking_stations = [{ position: { x: meters.x, y: meters.y } }];
    } else {
      const st = s.mapData.docking_stations[0];
      st.position = { x: meters.x, y: meters.y };
    }
    return { ...s, rev: s.rev + 1 };
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
