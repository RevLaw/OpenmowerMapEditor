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
  replaceAreas,
  addZoneFromPoints,
  insertPointAtIndex,
  movePoint,
  setDock,
  setDockHeading,
  removeDock,
  setStartPoint,
} from "./stores/editor.js";
import { markClean } from "./stores/dirty.js";
import { toggleTool, simplifyTolerance } from "./stores/tools.js";
import {
  simplify,
  offsetPolygon,
  polygonArea,
  nearestEdgeInsertIndex,
  boundingBox,
  boxesOverlap,
  minRingDistance,
  isPointInsidePolygon,
} from "./geo/geometry.js";
import { unionOutlines, subtractOutline, intersectOutlines, splitOutline } from "./geo/boolean.js";
import { mapApi } from "./stores/mapApi.js";
import {
  serializeMap,
  cloneMap,
  generateZoneId,
  getAreaType,
  getZoneName,
} from "./format/mapFormat.js";
import { getEditablePoints, closeLoop } from "./format/outline.js";
import {
  mapToGeoJSON,
  mapToKML,
  parseGeoJSON,
  parseKML,
  detectExchangeFormat,
} from "./format/exchange.js";
import * as api from "./api.js";
import { notify, setStatus } from "./stores/toast.js";
import {
  markMapReady,
  markParamsReady,
  refreshRobotIfLive,
  robotPose,
  robotLive,
} from "./stores/robot.js";
import { loadMowParams } from "./stores/mowParams.js";
import { currentLocked } from "./stores/zoneView.js";
import { saveDialog } from "./stores/ui.js";
import { checkForDraft, pendingDraft, discardPendingDraft } from "./stores/draft.js";
import { stopRecording } from "./stores/recorder.js";
import { trailZone, trailZoneOutline } from "./stores/trailZone.js";
import { pathToOutline } from "./robot/recorder.js";

export const backups = writable([]);

function currentMap() {
  return get(editor).mapData;
}

/** Refuse geometry edits on a locked zone (with a hint). True = OK to edit. */
export function guardEditable() {
  if (!get(currentLocked)) return true;
  notify("This zone is locked — unlock it in the zone list to edit.", "warn");
  return false;
}

function hasZone() {
  if (currentMap()?.areas?.length) return true;
  notify("No zone selected.", "warn");
  return false;
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

function downloadText(fileName, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCurrent() {
  const map = currentMap();
  if (!map) return;
  downloadText("openmower-map-edited.json", serializeMap(map), "application/json");
}

/** Open the confirm-before-save dialog (diff + validation), which then calls saveCurrent. */
export function requestSave({ restart = false } = {}) {
  if (!currentMap()) {
    notify("Load a map first.", "warn");
    return;
  }
  saveDialog.set({ restart });
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
  if (!guardEditable()) return;
  pushHistory();
  removeZoneRaw();
  const api$ = get(mapApi);
  if (api$) api$.fitCurrentArea();
  notify("Removed zone.", "info");
}

export function changeZoneType(type) {
  if (!hasZone() || !guardEditable()) return;
  pushHistory();
  setZoneType(type);
  notify(`Zone type set to ${type}.`, "info");
}

export function renameCurrentZone(name) {
  if (!currentMap()?.areas?.length || !guardEditable()) return;
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
  if (!currentMap()?.areas?.length || !guardEditable()) return;
  pushHistory();
  writeZoneOverride(rosKey, value);
}

export function removePoint() {
  const s = get(editor);
  if (!s.mapData) {
    notify("Load a map first.", "warn");
    return;
  }
  if (!guardEditable()) return;
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
  if (!s.mapData || !hasSelection || !guardEditable()) return;
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
  if (!hasZone() || !guardEditable()) return;
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
  if (!hasZone() || !guardEditable()) return;
  pushHistory();
  transformZone("rotate", (degrees * Math.PI) / 180);
}

export function scaleZone(factor) {
  if (!hasZone() || !guardEditable()) return;
  if (!(factor > 0)) {
    notify("Scale factor must be positive.", "warn");
    return;
  }
  pushHistory();
  transformZone("scale", factor);
}

/** Grow (m > 0) or shrink (m < 0) the zone by offsetting every border by m. */
export function growZone(meters) {
  if (!hasZone() || !guardEditable()) return;
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
    const map = currentMap();
    checkForDraft(map ? serializeMap(map) : null);
    await refreshBackups();
    markMapReady();
  }

  // Global mowing params for the accurate coverage preview (best-effort).
  loadMowParams();
}

// ---- vertex / dock precision edits ------------------------------------------

/** Move vertex `idx` of the current zone to exact map coordinates. */
export function setVertexCoords(idx, x, y) {
  if (!hasZone() || !guardEditable()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    notify("Enter valid coordinates.", "warn");
    return;
  }
  pushHistory();
  movePoint(idx, { x, y });
}

/** Make vertex `idx` the first outline point (sets where the auto mow angle is measured). */
export function makeStartPoint(idx) {
  if (!hasZone() || !guardEditable() || !(idx > 0)) return;
  pushHistory();
  setStartPoint(idx);
  notify("Start point moved — the auto mow angle follows the new first edge.", "info");
}

/** Set the dock position/heading exactly (heading in degrees, map frame, 0° = east). */
export function setDockExact({ x, y, headingDeg }) {
  const station = currentMap()?.docking_stations?.[0];
  if (!station?.position) {
    notify("Place a docking station first.", "warn");
    return;
  }
  const nx = Number.isFinite(x) ? x : station.position.x;
  const ny = Number.isFinite(y) ? y : station.position.y;
  pushHistory();
  setDock({ x: nx, y: ny });
  if (Number.isFinite(headingDeg)) setDockHeading((headingDeg * Math.PI) / 180);
}

export function removeDockAction() {
  if (!currentMap()?.docking_stations?.length) return;
  pushHistory();
  removeDock();
  notify("Docking station removed.", "info");
}

function livePose() {
  const pose = get(robotPose);
  if (!get(robotLive) || !pose?.ok || !Number.isFinite(pose.x)) {
    notify("No live robot position — turn on Live robot first.", "warn");
    return null;
  }
  return pose;
}

/** Place the dock at the robot's current pose (use while the mower sits docked). */
export function setDockFromRobot() {
  if (!currentMap()) {
    notify("Load a map first.", "warn");
    return;
  }
  const pose = livePose();
  if (!pose) return;
  pushHistory();
  setDock({ x: pose.x, y: pose.y }, Number.isFinite(pose.yaw) ? pose.yaw : undefined);
  notify("Docking station set from the robot's position and heading.", "success");
}

/** Insert the robot's current position into the selected zone, on its nearest edge. */
export function addRobotPointToZone() {
  if (!hasZone() || !guardEditable()) return;
  const pose = livePose();
  if (!pose) return;
  const p = { x: pose.x, y: pose.y };
  pushHistory();
  insertPointAtIndex(nearestEdgeInsertIndex(currentEditablePoints(), p), p);
  setStatus("Added the robot's position as a vertex.");
}

// ---- zones from the robot -------------------------------------------------

function fitNew() {
  get(mapApi)?.fitCurrentArea();
}

/** Finish a boundary recording and turn it into a zone. */
export function finishRecording(tolerance = 0.05) {
  const r = stopRecording();
  const outline = pathToOutline(r.points, tolerance);
  if (!outline) {
    notify("Recording too short — drive around the whole area first.", "warn");
    return;
  }
  pushHistory();
  addZoneFromPoints(r.type, outline);
  fitNew();
  notify(`Created ${r.type} zone from ${r.points.length} recorded points (${outline.length} vertices).`, "success");
}

/** Create a zone from the selected stretch of the movement trail. */
export function createZoneFromTrail() {
  if (!currentMap()) {
    notify("Load a map first.", "warn");
    return;
  }
  const outline = get(trailZoneOutline);
  if (!outline) {
    notify("That stretch of trail doesn't enclose an area — widen the range.", "warn");
    return;
  }
  const { type } = get(trailZone);
  pushHistory();
  addZoneFromPoints(type, outline);
  trailZone.update((tz) => ({ ...tz, open: false }));
  fitNew();
  notify(`Created ${type} zone from the trail (${outline.length} vertices).`, "success");
}

// ---- boolean zone operations ----------------------------------------------

function areaPoints(area) {
  return getEditablePoints(area?.outline || []);
}

/**
 * Other zones listed for merge / subtract / clip, overlapping or touching
 * ones first. Returns [{index, label, type, touching}].
 */
export function zoneOperationTargets() {
  const s = get(editor);
  const areas = s.mapData?.areas || [];
  const cur = areaPoints(areas[s.areaIndex]);
  if (cur.length < 3) return [];
  const curBox = boundingBox(cur);
  return areas
    .map((area, index) => ({ area, index }))
    .filter(({ index, area }) => index !== s.areaIndex && areaPoints(area).length >= 3)
    .map(({ area, index }) => {
      const pts = areaPoints(area);
      const touching =
        boxesOverlap(curBox, boundingBox(pts), 0.05) &&
        (isPointInsidePolygon(pts[0], cur) || isPointInsidePolygon(cur[0], pts) || minRingDistance(cur, pts) <= 0.05);
      return { index, label: getZoneName(area, index), type: getAreaType(area), touching };
    })
    .sort((a, b) => Number(b.touching) - Number(a.touching) || a.index - b.index);
}

/** Copy of an area with a new outline (and a fresh id when `newId`). */
function withOutline(area, points, newId = false) {
  const copy = cloneMap(area);
  copy.outline = closeLoop(points);
  if (newId) copy.id = generateZoneId();
  return copy;
}

/**
 * Write boolean-op results back: the current zone takes the largest piece,
 * extra pieces become new zones with the same properties. `removeIndex`
 * (optional) drops the other zone (merge).
 */
function commitPieces(pieces, { removeIndex = null, label }) {
  const s = get(editor);
  const areas = s.mapData.areas;
  const cur = areas[s.areaIndex];
  const next = [];
  let newIndex = 0;
  areas.forEach((area, i) => {
    if (i === removeIndex) return;
    if (i === s.areaIndex) {
      newIndex = next.length;
      next.push(withOutline(cur, pieces[0]));
      pieces.slice(1).forEach((p) => next.push(withOutline(cur, p, true)));
      return;
    }
    next.push(area);
  });
  pushHistory();
  replaceAreas(next, newIndex);
  notify(pieces.length > 1 ? `${label}: ${pieces.length} pieces.` : `${label}.`, "success");
}

/** Merge another zone into the selected one (union). */
export function mergeWithZone(otherIndex) {
  if (!hasZone() || !guardEditable()) return;
  const s = get(editor);
  const other = s.mapData.areas[otherIndex];
  if (!other || otherIndex === s.areaIndex) return;
  const { outlines, holes } = unionOutlines(areaPoints(s.mapData.areas[s.areaIndex]), areaPoints(other));
  if (outlines.length !== 1) {
    notify("Those zones don't overlap or touch — nothing to merge.", "warn");
    return;
  }
  commitPieces(outlines, { removeIndex: otherIndex, label: `Merged ${getZoneName(other, otherIndex)}` });
  if (holes) notify("The merge enclosed a gap — it was filled in (outlines can't have holes).", "info");
}

/** Cut another zone's shape out of the selected one (difference). */
export function subtractZone(otherIndex) {
  if (!hasZone() || !guardEditable()) return;
  const s = get(editor);
  const other = s.mapData.areas[otherIndex];
  if (!other || otherIndex === s.areaIndex) return;
  const { outlines, holes } = subtractOutline(areaPoints(s.mapData.areas[s.areaIndex]), areaPoints(other));
  if (holes) {
    notify("That zone sits fully inside — use it as an obstacle instead of cutting a hole.", "warn");
    return;
  }
  if (!outlines.length) {
    notify("Nothing would be left of this zone.", "warn");
    return;
  }
  commitPieces(outlines, { label: `Cut out ${getZoneName(other, otherIndex)}` });
}

/** Keep only the part of the selected zone inside another (intersection). */
export function clipToZone(otherIndex) {
  if (!hasZone() || !guardEditable()) return;
  const s = get(editor);
  const other = s.mapData.areas[otherIndex];
  if (!other || otherIndex === s.areaIndex) return;
  const { outlines } = intersectOutlines(areaPoints(s.mapData.areas[s.areaIndex]), areaPoints(other));
  if (!outlines.length) {
    notify("The zones don't overlap — clipping would remove this zone.", "warn");
    return;
  }
  commitPieces(outlines, { label: `Clipped to ${getZoneName(other, otherIndex)}` });
}

/** Split the selected zone along the line p1→p2 (from the split tool). */
export function splitCurrentZone(p1, p2) {
  if (!hasZone() || !guardEditable()) return false;
  const pieces = splitOutline(currentEditablePoints(), p1, p2);
  if (pieces.length < 2) {
    notify("The split line has to cross the zone.", "warn");
    return false;
  }
  commitPieces(pieces, { label: "Split zone" });
  return true;
}

// ---- GeoJSON / KML exchange ---------------------------------------------------

/** Download the map as GeoJSON or KML (WGS84, using the current projection origin). */
export function exportMap(format) {
  const map = currentMap();
  if (!map) {
    notify("Load a map first.", "warn");
    return;
  }
  const origin = get(editor).origin;
  if (format === "kml") {
    downloadText("openmower-map.kml", mapToKML(map, origin), "application/vnd.google-earth.kml+xml");
  } else if (format === "json") {
    downloadText("map.json", serializeMap(map), "application/json");
  } else {
    downloadText(
      "openmower-map.geojson",
      JSON.stringify(mapToGeoJSON(map, origin), null, 2),
      "application/geo+json"
    );
  }
  setStatus(`Exported map as ${format.toUpperCase()}.`);
}

/**
 * Import zones (and optionally the dock) from a GeoJSON / KML file into the
 * current map. Polygons without a recognised `type` get `defaultType`.
 */
export async function importExchangeFile(file, { defaultType = "mow", replaceDock = true } = {}) {
  if (!currentMap()) {
    notify("Load or create a map first.", "warn");
    return;
  }
  let result;
  try {
    const text = await file.text();
    const origin = get(editor).origin;
    result =
      detectExchangeFormat(file.name, text) === "kml"
        ? parseKML(text, origin, defaultType)
        : parseGeoJSON(text, origin, defaultType);
  } catch (e) {
    notify(`Import failed: ${e.message}`, "error");
    return;
  }
  if (!result.areas.length && !result.dock) {
    notify("No polygons found in that file.", "warn");
    return;
  }
  const s = get(editor);
  const existingIds = new Set((s.mapData.areas || []).map((a) => a.id));
  const imported = result.areas.map((a) => ({
    id: a.id && !existingIds.has(a.id) ? a.id : generateZoneId(),
    properties: a.properties,
    outline: closeLoop(a.points),
  }));
  pushHistory();
  if (imported.length) replaceAreas([...(s.mapData.areas || []), ...imported], s.mapData.areas.length);
  if (result.dock && replaceDock) setDock(result.dock.position, result.dock.heading);
  if (imported.length) fitNew();
  const parts = [`${imported.length} zone${imported.length === 1 ? "" : "s"}`];
  if (result.dock && replaceDock) parts.push("dock");
  if (result.skipped) parts.push(`${result.skipped} skipped`);
  notify(`Imported ${parts.join(", ")} from "${file.name}".`, "success");
}

// ---- draft restore --------------------------------------------------------------

/** Restore the unsaved draft found at startup (stays unsaved until you save). */
export function restoreDraft() {
  const d = get(pendingDraft);
  if (!d) return;
  try {
    loadMap(d.text);
    pendingDraft.set(null);
    fitNew();
    notify("Restored your unsaved draft — save to apply it to the robot.", "success");
  } catch (_e) {
    discardPendingDraft();
    notify("The saved draft was unreadable and has been discarded.", "warn");
  }
}

export { discardPendingDraft };
