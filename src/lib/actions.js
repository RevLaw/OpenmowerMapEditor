// High-level user actions shared by the UI buttons, keyboard shortcuts, and
// the command palette — so all three stay consistent.
import { get, writable } from "svelte/store";
import {
  editor,
  loadMap,
  addZone as addZoneRaw,
  removeZone as removeZoneRaw,
  applyProjection as applyProjectionRaw,
  currentEditablePoints,
  deleteSelectedPoints,
  nudgeSelection,
  transformZone,
  simplifyZone,
  offsetZone,
  duplicateZone,
  setZoneType,
  setZoneName,
  writeZoneOverride,
  reorderZone,
  pushHistory,
  undo as undoRaw,
  redo as redoRaw,
  setOrigin,
} from "./stores/editor.js";
import { markClean } from "./stores/dirty.js";
import { toggleTool, simplifyTolerance } from "./stores/tools.js";
import { simplify, offsetPolygon, polygonArea } from "./geo/geometry.js";
import { mapApi } from "./stores/mapApi.js";
import { serializeMap } from "./format/mapFormat.js";
import * as api from "./api.js";
import { notify, setStatus } from "./stores/toast.js";
import { markMapReady, markParamsReady, refreshRobotIfLive } from "./stores/robot.js";
import { loadMowParams } from "./stores/mowParams.js";

export const backups = writable([]);

function currentMap() {
  return get(editor).mapData;
}

// ---- map loading -----------------------------------------------------------

export function loadMapText(text, message) {
  loadMap(text);
  markClean();
  const api$ = get(mapApi);
  if (api$) api$.fitCurrentArea();
  const count = currentMap()?.areas?.length ?? 0;
  setStatus(message || `Loaded map with ${count} area(s).`);
  refreshRobotIfLive();
}

export async function loadFromFile(file) {
  try {
    const text = await file.text();
    loadMapText(text, `Loaded "${file.name}".`);
  } catch (e) {
    notify(`Failed to read file: ${e.message}`, "error");
  }
}

export async function refreshBackups() {
  try {
    backups.set(await api.fetchBackups());
  } catch (_e) {
    backups.set([]);
  }
}

export async function loadBackup(name) {
  if (!name) return;
  try {
    const text = await api.fetchBackup(name);
    loadMapText(
      text,
      name === "map.json"
        ? "Loaded running map.json."
        : `Loaded backup "${name}". Save to apply it as map.json.`
    );
    await refreshBackups();
  } catch (_e) {
    notify("Failed to load selected map file.", "error");
  }
}

// ---- saving ----------------------------------------------------------------

function downloadCurrent() {
  const map = currentMap();
  if (!map) return;
  const blob = new Blob([serializeMap(map)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "openmower-map-edited.json";
  a.click();
  URL.revokeObjectURL(url);
}

export async function saveCurrent({ restart = false } = {}) {
  if (!currentMap()) {
    notify("Load a map first.", "warn");
    return;
  }
  try {
    const result = await api.saveMap(currentMap(), { restart });
    markClean();
    refreshBackups();
    if (!restart) {
      notify("Saved /data/ros/map.json (backup created).", "success");
      return;
    }
    const container = result?.restartContainer || "open_mower_ros";
    if (result?.restartResult?.restarted) {
      notify(`Saved map.json and restarted '${container}'.`, "success");
    } else if (result?.restartResult?.reason) {
      notify(`Saved map.json. Restart skipped: ${result.restartResult.reason}.`, "warn");
    } else {
      notify("Saved /data/ros/map.json (backup created).", "success");
    }
  } catch (_e) {
    downloadCurrent();
    markClean();
    notify("Server save unavailable. Downloaded JSON instead.", "warn");
  }
}

// ---- zone / point actions --------------------------------------------------

export function addZoneAtCenter(type) {
  if (!currentMap()) {
    notify("Load a map first.", "warn");
    return;
  }
  const api$ = get(mapApi);
  const center = api$ ? api$.getCenterMeters() : { x: 0, y: 0 };
  pushHistory();
  addZoneRaw(type, center);
  if (api$) api$.fitCurrentArea();
  notify(`Added new ${type} zone.`, "success");
}

export function removeCurrentZone() {
  if (!currentMap()?.areas?.length) {
    notify("No zone to remove.", "warn");
    return;
  }
  pushHistory();
  removeZoneRaw();
  const api$ = get(mapApi);
  if (api$) api$.fitCurrentArea();
  notify("Removed zone.", "info");
}

export function changeZoneType(type) {
  if (!currentMap()?.areas?.length) {
    notify("No zone selected.", "warn");
    return;
  }
  pushHistory();
  setZoneType(type);
  notify(`Zone type set to ${type}.`, "info");
}

export function renameCurrentZone(name) {
  if (!currentMap()?.areas?.length) return;
  pushHistory();
  setZoneName(name);
}

export function moveZoneOrder(dir) {
  if (!currentMap()?.areas?.length) return;
  pushHistory();
  reorderZone(dir);
}

/** Set/clear a per-area mowing override (rosKey, value|null) on the zone. */
export function setZoneOverride(rosKey, value) {
  if (!currentMap()?.areas?.length) return;
  pushHistory();
  writeZoneOverride(rosKey, value);
}

export function removePoint() {
  const s = get(editor);
  if (!s.mapData) {
    notify("Load a map first.", "warn");
    return;
  }
  const targets = s.selectedPointIndices.length
    ? s.selectedPointIndices
    : s.pointIndex != null
      ? [s.pointIndex]
      : [];
  if (!targets.length) {
    notify("Select a point first.", "warn");
    return;
  }
  if (currentEditablePoints().length - targets.length < 3) {
    notify("Need at least 3 border points for a valid area.", "warn");
    return;
  }
  pushHistory();
  const removed = deleteSelectedPoints();
  setStatus(removed > 1 ? `Removed ${removed} points.` : "Selected point removed.");
}

let lastNudgeAt = 0;

/** Nudge the current selection by (dx,dy) meters; coalesces rapid presses. */
export function nudge(dx, dy) {
  const s = get(editor);
  const hasSelection = s.selectedPointIndices.length > 0 || s.pointIndex != null;
  if (!s.mapData || !hasSelection) return;
  const now = Date.now();
  if (now - lastNudgeAt > 800) pushHistory();
  lastNudgeAt = now;
  nudgeSelection(dx, dy);
}

export function duplicateZoneAction() {
  if (!currentMap()?.areas?.length) {
    notify("No zone to duplicate.", "warn");
    return;
  }
  pushHistory();
  duplicateZone();
  notify("Zone duplicated.", "success");
}

export function simplifyZoneAction() {
  if (!currentMap()?.areas?.length) {
    notify("No zone selected.", "warn");
    return;
  }
  const tol = get(simplifyTolerance);
  const pts = currentEditablePoints();
  if (pts.length - simplify(pts, tol).length <= 0) {
    setStatus("Nothing to simplify at this tolerance.");
    return;
  }
  pushHistory();
  const removed = simplifyZone(tol);
  notify(`Simplified: removed ${removed} point(s).`, "success");
}

export function rotateZone(degrees) {
  if (!currentMap()?.areas?.length) {
    notify("No zone selected.", "warn");
    return;
  }
  pushHistory();
  transformZone("rotate", (degrees * Math.PI) / 180);
}

export function scaleZone(factor) {
  if (!currentMap()?.areas?.length) {
    notify("No zone selected.", "warn");
    return;
  }
  pushHistory();
  transformZone("scale", factor);
}

/** Grow (m > 0) or shrink (m < 0) the zone by offsetting every border by m. */
export function growZone(meters) {
  if (!currentMap()?.areas?.length) {
    notify("No zone selected.", "warn");
    return;
  }
  const next = offsetPolygon(currentEditablePoints(), -meters);
  if (next.length < 3 || polygonArea(next) < 0.01) {
    notify("Zone too small to resize further.", "warn");
    return;
  }
  pushHistory();
  offsetZone(meters);
}

export function applyProjection(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    notify("Invalid origin coordinates.", "error");
    return;
  }
  if (currentMap()) pushHistory();
  applyProjectionRaw(lat, lng);
  const api$ = get(mapApi);
  if (api$) api$.fitCurrentArea();
  notify("Projection updated.", "success");
  refreshRobotIfLive();
}

export function undo() {
  if (!undoRaw()) setStatus("Nothing to undo.");
  else setStatus("Undo applied.");
}

export function redo() {
  if (!redoRaw()) setStatus("Nothing to redo.");
  else setStatus("Redo applied.");
}

export function toggleToolAction(tool) {
  toggleTool(tool);
}

// ---- startup ---------------------------------------------------------------

export async function bootstrap() {
  // Datum origin from params (best-effort).
  try {
    const origin = await api.fetchParams();
    setOrigin(origin);
  } catch (_e) {
    /* keep default origin */
  } finally {
    markParamsReady();
  }

  // Active map.json (best-effort).
  try {
    const text = await api.fetchActiveMap();
    loadMapText(text, "Loaded /data/ros/map.json.");
  } catch (_e) {
    setStatus("Load a map to begin.");
  } finally {
    await refreshBackups();
    markMapReady();
  }

  // Global mowing params for the accurate coverage preview (best-effort).
  loadMowParams();
}
