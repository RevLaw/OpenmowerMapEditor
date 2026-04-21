const state = {
  rawMap: null,
  areaIndex: 0,
  pointIndex: null,
  multiSelectMode: false,
  selectedPointIndices: [],
  addMode: false,
  brushMode: false,
  cleanupMode: false,
  brushPainting: false,
  brushStrokeMovedCount: 0,
  brushCursorLatLng: null,
  snapMode: false,
  snapPointIndices: [],
  boxSelectActive: false,
  boxSelectStartLatLng: null,
  currentEditableLatLngs: [],
  originLat: 52.52,
  originLng: 13.405,
};
const EDITOR_META_KEY = "__editor";
const DEFAULT_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const map = L.map("map").setView([52.52, 13.405], 19);
let baseLayer = null;

const layers = {
  areaLine: null,
  pointMarkers: [],
  selectedMarker: null,
  multiDragMarker: null,
  dockingMarker: null,
  snapGuideLine: null,
  boxSelectRect: null,
  brushCursor: null,
};

const history = {
  undoStack: [],
  redoStack: [],
};
let suppressNextMapClick = false;
let ignoreMapClicksUntil = 0;

const ui = {
  file: document.getElementById("jsonFile"),
  areaSelect: document.getElementById("areaSelect"),
  undoEdit: document.getElementById("undoEdit"),
  redoEdit: document.getElementById("redoEdit"),
  toggleMultiSelect: document.getElementById("toggleMultiSelect"),
  toggleAdd: document.getElementById("toggleAdd"),
  toggleBrush: document.getElementById("toggleBrush"),
  toggleSnap: document.getElementById("toggleSnap"),
  brushRadius: document.getElementById("brushRadius"),
  brushRadiusValue: document.getElementById("brushRadiusValue"),
  brushStrength: document.getElementById("brushStrength"),
  brushStrengthValue: document.getElementById("brushStrengthValue"),
  brushControls: document.getElementById("brushControls"),
  cleanupThreshold: document.getElementById("cleanupThreshold"),
  cleanupThresholdValue: document.getElementById("cleanupThresholdValue"),
  cleanupControls: document.getElementById("cleanupControls"),
  cleanupPoints: document.getElementById("cleanupPoints"),
  removePoint: document.getElementById("removePoint"),
  saveMapJson: document.getElementById("saveMapJson"),
  saveMapJsonRestart: document.getElementById("saveMapJsonRestart"),
  backupSelect: document.getElementById("backupSelect"),
  status: document.getElementById("status"),
  originLat: document.getElementById("originLat"),
  originLng: document.getElementById("originLng"),
  applyProjection: document.getElementById("applyProjection"),
};

function updateStatus(message) {
  ui.status.textContent = message;
}

function formatSliderValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toFixed(2).replace(/\.?0+$/, "");
}

function syncSliderLabels() {
  ui.brushRadiusValue.textContent = formatSliderValue(ui.brushRadius.value);
  ui.brushStrengthValue.textContent = formatSliderValue(ui.brushStrength.value);
  ui.cleanupThresholdValue.textContent = formatSliderValue(ui.cleanupThreshold.value);
}

function readPositiveSliderValue(input, fallbackValue) {
  const numeric = Number(input.value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackValue;
}

function refreshToolButtons() {
  ui.toggleMultiSelect.classList.toggle("is-active", state.multiSelectMode);
  ui.toggleAdd.classList.toggle("is-active", state.addMode);
  ui.toggleBrush.classList.toggle("is-active", state.brushMode);
  ui.toggleSnap.classList.toggle("is-active", state.snapMode);
  ui.cleanupPoints.classList.toggle("is-active", state.cleanupMode);
}

function refreshToolPanels() {
  ui.brushControls.classList.toggle("is-visible", state.brushMode);
  ui.cleanupControls.classList.toggle("is-visible", state.cleanupMode);
}

function refreshToolUi() {
  refreshToolButtons();
  refreshToolPanels();
}

function triggerJsonDownload() {
  const blob = new Blob([JSON.stringify(state.rawMap, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "openmower-map-edited.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function saveMapToServer({ restart }) {
  const url = restart ? "./api/map?restart=1" : "./api/map";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(state.rawMap),
  });
  if (!response.ok) {
    throw new Error("Server save failed");
  }
  return response.json();
}

async function refreshBackupList() {
  const response = await fetch("./api/map/backups");
  if (!response.ok) {
    throw new Error("Failed to list backups");
  }
  const payload = await response.json();
  const backups = Array.isArray(payload.backups) ? payload.backups : [];
  ui.backupSelect.innerHTML = "";
  if (backups.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No map files found";
    ui.backupSelect.appendChild(option);
    return;
  }
  backups.forEach((backupName) => {
    const option = document.createElement("option");
    option.value = backupName;
    option.textContent = backupName === "map.json" ? "map.json (running)" : backupName;
    ui.backupSelect.appendChild(option);
  });
}

async function loadSelectedBackup() {
  const backupName = ui.backupSelect.value;
  if (!backupName) return;
  const response = await fetch(`./api/map/backups/${encodeURIComponent(backupName)}`);
  if (!response.ok) {
    throw new Error("Map file load failed");
  }
  const text = await response.text();
  loadMapFromText(text);
  await refreshBackupList().catch(() => {});
  ui.backupSelect.value = backupName;
  updateStatus(
    backupName === "map.json"
      ? "Loaded running map.json."
      : `Loaded backup '${backupName}'. Save to apply it as map.json.`
  );
}

function setAddMode(enabled) {
  state.addMode = enabled;
  refreshToolUi();
}

function setBrushMode(enabled) {
  state.brushMode = enabled;
  refreshToolUi();
  if (!enabled) {
    state.brushPainting = false;
    state.brushStrokeMovedCount = 0;
    state.brushCursorLatLng = null;
    if (layers.brushCursor) {
      map.removeLayer(layers.brushCursor);
      layers.brushCursor = null;
    }
    map.getContainer().style.cursor = "";
    map.dragging.enable();
  }
}

function updateBrushCursorPreview(latlng) {
  state.brushCursorLatLng = latlng;
  if (!state.brushMode) return;

  const radius = Number(ui.brushRadius.value);
  const radiusMeters = Number.isFinite(radius) && radius > 0 ? radius : 0.35;
  if (layers.brushCursor) {
    layers.brushCursor.setLatLng(latlng);
    layers.brushCursor.setRadius(radiusMeters);
    return;
  }

  layers.brushCursor = L.circle(latlng, {
    radius: radiusMeters,
    color: "#38bdf8",
    weight: 1,
    opacity: 0.9,
    fillColor: "#38bdf8",
    fillOpacity: 0.08,
    interactive: false,
  }).addTo(map);
}

function setMultiSelectMode(enabled) {
  state.multiSelectMode = enabled;
  if (!enabled) {
    state.selectedPointIndices = [];
  }
  refreshToolUi();
}

function setSnapMode(enabled) {
  state.snapMode = enabled;
  if (!enabled) {
    state.snapPointIndices = [];
  }
  refreshToolUi();
}

function setCleanupMode(enabled) {
  state.cleanupMode = enabled;
  refreshToolUi();
}

function deactivateEditingModes(options = {}) {
  const keep = options.keep || null;
  if (keep !== "multi") setMultiSelectMode(false);
  if (keep !== "add") setAddMode(false);
  if (keep !== "brush") setBrushMode(false);
  if (keep !== "snap") setSnapMode(false);
  if (keep !== "cleanup") setCleanupMode(false);
}

function cloneMapData(mapData) {
  return JSON.parse(JSON.stringify(mapData));
}

function pushHistorySnapshot() {
  if (!state.rawMap) return;
  history.undoStack.push({
    rawMap: cloneMapData(state.rawMap),
    areaIndex: state.areaIndex,
    pointIndex: state.pointIndex,
    originLat: state.originLat,
    originLng: state.originLng,
  });
  if (history.undoStack.length > 100) {
    history.undoStack.shift();
  }
  history.redoStack = [];
}

function restoreSnapshot(snapshot) {
  state.rawMap = cloneMapData(snapshot.rawMap);
  state.areaIndex = snapshot.areaIndex;
  state.pointIndex = snapshot.pointIndex;
  state.originLat = snapshot.originLat;
  state.originLng = snapshot.originLng;
  ui.originLat.value = String(state.originLat);
  ui.originLng.value = String(state.originLng);
  state.addMode = false;
  setBrushMode(false);
  setSnapMode(false);
  setCleanupMode(false);
  setMultiSelectMode(false);
  refreshAreaSelect();
  renderMap();
}

function applyTileLayer() {
  if (baseLayer) {
    map.removeLayer(baseLayer);
    baseLayer = null;
  }
  baseLayer = L.tileLayer(DEFAULT_TILE_URL, {
    attribution:
      "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxNativeZoom: 20,
    maxZoom: 26,
    minZoom: 1,
  }).addTo(map);
}

function metersToLatLng(point) {
  const lat = state.originLat + point.y / 111320;
  const lng =
    state.originLng +
    point.x / (111320 * Math.cos((state.originLat * Math.PI) / 180));
  return [lat, lng];
}

function latLngToMeters(latlng) {
  const x =
    (latlng.lng - state.originLng) *
    (111320 * Math.cos((state.originLat * Math.PI) / 180));
  const y = (latlng.lat - state.originLat) * 111320;
  return { x, y };
}

function getCurrentOutline() {
  if (!state.rawMap?.areas?.length) return null;
  return state.rawMap.areas[state.areaIndex].outline;
}

function isClosedLoop(outline) {
  if (!outline || outline.length < 2) return false;
  const first = outline[0];
  const last = outline[outline.length - 1];
  return first.x === last.x && first.y === last.y;
}

function ensureClosedLoop(outline) {
  if (!outline || outline.length < 2) return;
  if (!isClosedLoop(outline)) {
    outline.push({ x: outline[0].x, y: outline[0].y });
  } else {
    outline[outline.length - 1] = { x: outline[0].x, y: outline[0].y };
  }
}

function setEditablePoint(outline, editableIdx, point) {
  outline[editableIdx] = { x: point.x, y: point.y };
  // Lock closure endpoints together: point 1 <-> last point.
  if (editableIdx === 0 && outline.length > 1) {
    outline[outline.length - 1] = { x: point.x, y: point.y };
  }
}

function getEditablePointCount(outline) {
  if (!outline) return 0;
  return isClosedLoop(outline) ? Math.max(0, outline.length - 1) : outline.length;
}

function toEditableIndex(rawIndex, outline) {
  if (!outline || rawIndex == null) return null;
  const editableCount = getEditablePointCount(outline);
  if (editableCount === 0) return null;
  if (rawIndex >= editableCount) return 0;
  return rawIndex;
}

function persistEditorMeta() {
  if (!state.rawMap) return;
  state.rawMap[EDITOR_META_KEY] = {
    originLat: state.originLat,
    originLng: state.originLng,
  };
}

function clearMapLayers() {
  if (layers.areaLine) {
    map.removeLayer(layers.areaLine);
    layers.areaLine = null;
  }
  layers.pointMarkers.forEach((m) => map.removeLayer(m));
  layers.pointMarkers = [];
  if (layers.selectedMarker) {
    map.removeLayer(layers.selectedMarker);
    layers.selectedMarker = null;
  }
  if (layers.multiDragMarker) {
    map.removeLayer(layers.multiDragMarker);
    layers.multiDragMarker = null;
  }
  if (layers.dockingMarker) {
    map.removeLayer(layers.dockingMarker);
    layers.dockingMarker = null;
  }
  if (layers.snapGuideLine) {
    map.removeLayer(layers.snapGuideLine);
    layers.snapGuideLine = null;
  }
  if (layers.boxSelectRect) {
    map.removeLayer(layers.boxSelectRect);
    layers.boxSelectRect = null;
  }
}

function fitCurrentArea() {
  const outline = getCurrentOutline();
  if (!outline || outline.length === 0) return;
  const latlngs = outline.map(metersToLatLng);
  const bounds = L.latLngBounds(latlngs);
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.2));
  }
}

function renderMap() {
  clearMapLayers();
  const outline = getCurrentOutline();
  if (!outline) return;
  ensureClosedLoop(outline);
  state.pointIndex = toEditableIndex(state.pointIndex, outline);

  const editableCount = getEditablePointCount(outline);
  const editablePoints = outline.slice(0, editableCount);
  state.selectedPointIndices = state.selectedPointIndices.filter(
    (idx) => idx >= 0 && idx < editableCount
  );
  const latlngs = editablePoints.map(metersToLatLng);
  state.currentEditableLatLngs = latlngs;
  const closedLatLngs = latlngs.length > 1 ? [...latlngs, latlngs[0]] : latlngs;
  layers.areaLine = L.polyline(closedLatLngs, {
    color: "#ffffff",
    weight: 0.2,
    opacity: 0.9,
  }).addTo(map);

  latlngs.forEach((latlng, idx) => {
    const isSelected = idx === state.pointIndex;
    const isSnapEndpoint = state.snapPointIndices.includes(idx);
    const isMultiSelected = state.selectedPointIndices.includes(idx);
    const isFirstPoint = idx === 0;
    const baseColor = isFirstPoint ? "#22c55e" : "#f59e0b";
    const marker = L.circleMarker(latlng, {
      radius: isSelected ? 5 : 3.5,
      color: isSnapEndpoint
        ? "#a855f7"
        : isMultiSelected
          ? "#22d3ee"
          : isSelected
            ? "#ef4444"
            : baseColor,
      fillColor: isSnapEndpoint
        ? "#a855f7"
        : isMultiSelected
          ? "#22d3ee"
          : isSelected
            ? "#ef4444"
            : baseColor,
      fillOpacity: 1,
      weight: isSelected ? 1.2 : 0.9,
    }).addTo(map);
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      if (state.multiSelectMode) {
        const currentSet = new Set(state.selectedPointIndices);
        if (currentSet.has(idx)) {
          currentSet.delete(idx);
        } else {
          currentSet.add(idx);
        }
        state.selectedPointIndices = [...currentSet].sort((a, b) => a - b);
        renderMap();
        updateStatus(`${state.selectedPointIndices.length} point(s) selected for group move.`);
        return;
      }
      if (state.addMode) {
        setAddMode(false);
      }
      if (state.snapMode) {
        handleSnapPointSelection(idx);
        return;
      }
      state.pointIndex = idx;
      renderMap();
      updateStatus(`Selected point ${idx + 1}/${editableCount}.`);
    });
    layers.pointMarkers.push(marker);
  });

  if (state.pointIndex != null && editablePoints[state.pointIndex]) {
    const selectedLatLng = metersToLatLng(editablePoints[state.pointIndex]);
    layers.selectedMarker = L.marker(selectedLatLng, {
      draggable: true,
      title: "Drag to move selected point",
    }).addTo(map);
    layers.selectedMarker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
    });
    layers.selectedMarker.on("dragstart", () => {
      if (state.addMode) {
        setAddMode(false);
      }
      suppressNextMapClick = true;
      ignoreMapClicksUntil = Date.now() + 700;
    });
    layers.selectedMarker.on("dragend", (e) => {
      ignoreMapClicksUntil = Date.now() + 700;
      pushHistorySnapshot();
      const meters = latLngToMeters(e.target.getLatLng());
      setEditablePoint(outline, state.pointIndex, meters);
      ensureClosedLoop(outline);
      renderMap();
      updateStatus(`Moved point ${state.pointIndex + 1}.`);
    });
  }

  if (state.selectedPointIndices.length > 1) {
    const selectedLatLngs = state.selectedPointIndices.map((idx) =>
      metersToLatLng(editablePoints[idx])
    );
    const centerLat =
      selectedLatLngs.reduce((sum, item) => sum + item[0], 0) / selectedLatLngs.length;
    const centerLng =
      selectedLatLngs.reduce((sum, item) => sum + item[1], 0) / selectedLatLngs.length;

    const groupIcon = L.divIcon({
      className: "home-station-icon",
      html: "&#x21f2;",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    layers.multiDragMarker = L.marker([centerLat, centerLng], {
      draggable: true,
      icon: groupIcon,
      title: "Drag to move selected points together",
    }).addTo(map);

    let dragStartMeters = null;
    const selectedSnapshot = state.selectedPointIndices.map((idx) => ({
      idx,
      point: { x: editablePoints[idx].x, y: editablePoints[idx].y },
    }));

    layers.multiDragMarker.on("dragstart", () => {
      if (state.addMode) {
        setAddMode(false);
      }
      suppressNextMapClick = true;
      ignoreMapClicksUntil = Date.now() + 700;
      dragStartMeters = latLngToMeters(layers.multiDragMarker.getLatLng());
      pushHistorySnapshot();
    });

    layers.multiDragMarker.on("dragend", () => {
      ignoreMapClicksUntil = Date.now() + 700;
      if (!dragStartMeters) return;
      const dragEndMeters = latLngToMeters(layers.multiDragMarker.getLatLng());
      const dx = dragEndMeters.x - dragStartMeters.x;
      const dy = dragEndMeters.y - dragStartMeters.y;

      for (let i = 0; i < selectedSnapshot.length; i += 1) {
        const item = selectedSnapshot[i];
        setEditablePoint(outline, item.idx, {
          x: item.point.x + dx,
          y: item.point.y + dy,
        });
      }
      ensureClosedLoop(outline);
      renderMap();
      updateStatus(`Moved ${selectedSnapshot.length} selected points together.`);
    });
  }

  if (state.snapPointIndices.length > 0) {
    const pointA = editablePoints[state.snapPointIndices[0]];
    const pointB =
      state.snapPointIndices.length > 1
        ? editablePoints[state.snapPointIndices[1]]
        : null;
    const snapLatLngs = pointB
      ? [metersToLatLng(pointA), metersToLatLng(pointB)]
      : [metersToLatLng(pointA)];
    layers.snapGuideLine = L.polyline(snapLatLngs, {
      color: "#e11d48",
      weight: 1,
      opacity: 0.9,
      dashArray: "6,6",
    }).addTo(map);
  }

  renderDockingStation();
  if (state.brushMode && state.brushCursorLatLng) {
    updateBrushCursorPreview(state.brushCursorLatLng);
  }
}

function renderDockingStation() {
  const station = state.rawMap?.docking_stations?.[0];
  if (!station?.position) return;

  const stationLatLng = metersToLatLng(station.position);
  const homeIcon = L.divIcon({
    className: "home-station-icon",
    html: "&#8962;",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

  layers.dockingMarker = L.marker(stationLatLng, {
    draggable: true,
    icon: homeIcon,
    title: "Home station (drag to move)",
  }).addTo(map);
  layers.dockingMarker.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
  });

  layers.dockingMarker.on("dragend", (e) => {
    ignoreMapClicksUntil = Date.now() + 700;
    pushHistorySnapshot();
    const meters = latLngToMeters(e.target.getLatLng());
    station.position.x = meters.x;
    station.position.y = meters.y;
    renderMap();
    updateStatus("Home station moved.");
  });
}

function refreshAreaSelect() {
  ui.areaSelect.innerHTML = "";
  const areas = state.rawMap?.areas || [];
  areas.forEach((area, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `${i + 1}: ${area.properties?.type || "area"} (${area.id})`;
    ui.areaSelect.appendChild(option);
  });
  ui.areaSelect.value = String(state.areaIndex);
}

function loadMapFromText(text) {
  const parsed = JSON.parse(text);
  if (!parsed.areas || !Array.isArray(parsed.areas)) {
    throw new Error("Invalid map format: missing areas array.");
  }

  state.rawMap = parsed;
  const editorMeta = parsed?.[EDITOR_META_KEY];
  if (
    editorMeta &&
    Number.isFinite(editorMeta.originLat) &&
    Number.isFinite(editorMeta.originLng)
  ) {
    state.originLat = editorMeta.originLat;
    state.originLng = editorMeta.originLng;
    ui.originLat.value = String(state.originLat);
    ui.originLng.value = String(state.originLng);
  }
  state.areaIndex = 0;
  state.pointIndex = null;
  state.snapPointIndices = [];
  state.selectedPointIndices = [];
  setCleanupMode(false);
  history.undoStack = [];
  history.redoStack = [];
  applyTileLayer();
  persistEditorMeta();
  refreshAreaSelect();
  renderMap();
  fitCurrentArea();
  updateStatus(
    `Loaded map with ${parsed.areas.length} area(s). Select a point to move/remove.`
  );
}

ui.file.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    loadMapFromText(text);
  } catch (error) {
    updateStatus(`Failed to read file: ${error.message}`);
  }
});

ui.areaSelect.addEventListener("change", () => {
  state.areaIndex = Number(ui.areaSelect.value);
  state.pointIndex = null;
  state.selectedPointIndices = [];
  renderMap();
  fitCurrentArea();
});

ui.toggleMultiSelect.addEventListener("click", () => {
  setMultiSelectMode(!state.multiSelectMode);
  if (state.multiSelectMode) {
    deactivateEditingModes({ keep: "multi" });
    updateStatus(
      "Multi-select ON: click points or use Shift+drag box select, then drag group handle."
    );
  } else {
    state.boxSelectActive = false;
    state.boxSelectStartLatLng = null;
    if (layers.boxSelectRect) {
      map.removeLayer(layers.boxSelectRect);
      layers.boxSelectRect = null;
    }
    map.dragging.enable();
    updateStatus("Multi-select OFF.");
  }
  renderMap();
});

ui.toggleAdd.addEventListener("click", () => {
  setAddMode(!state.addMode);
  if (state.addMode) {
    deactivateEditingModes({ keep: "add" });
  }
  updateStatus(
    state.addMode
      ? "Add mode ON: click map to insert a point."
      : "Add mode OFF."
  );
});

ui.toggleBrush.addEventListener("click", () => {
  setBrushMode(!state.brushMode);
  if (state.brushMode) {
    deactivateEditingModes({ keep: "brush" });
    updateStatus("Push brush ON: click or hold and drag to push nearby points outward.");
    map.getContainer().style.cursor = "crosshair";
    if (state.brushCursorLatLng) {
      updateBrushCursorPreview(state.brushCursorLatLng);
    }
  } else {
    updateStatus("Push brush OFF.");
    map.getContainer().style.cursor = "";
  }
  renderMap();
});

ui.brushRadius.addEventListener("input", () => {
  syncSliderLabels();
  if (!state.brushMode || !state.brushCursorLatLng) return;
  updateBrushCursorPreview(state.brushCursorLatLng);
});

ui.brushStrength.addEventListener("input", () => {
  syncSliderLabels();
});

ui.cleanupThreshold.addEventListener("input", () => {
  syncSliderLabels();
});

ui.toggleSnap.addEventListener("click", () => {
  setSnapMode(!state.snapMode);
  if (state.snapMode) {
    deactivateEditingModes({ keep: "snap" });
  }
  renderMap();
  updateStatus(
    state.snapMode
      ? "Snap mode ON: click start point and end point."
      : "Snap mode OFF."
  );
});

function buildCircularIndexPath(startIdx, endIdx, count) {
  const path = [startIdx];
  let current = startIdx;
  for (let safety = 0; safety < count; safety += 1) {
    if (current === endIdx) {
      break;
    }
    current = (current + 1) % count;
    path.push(current);
  }
  return path;
}

function snapRangeEvenlyBetween(startIdx, endIdx) {
  const outline = getCurrentOutline();
  if (!outline) return 0;
  ensureClosedLoop(outline);
  const editableCount = getEditablePointCount(outline);

  if (
    startIdx == null ||
    endIdx == null ||
    startIdx < 0 ||
    endIdx < 0 ||
    startIdx >= editableCount ||
    endIdx >= editableCount ||
    startIdx === endIdx
  ) {
    return 0;
  }

  const indexPath = buildCircularIndexPath(startIdx, endIdx, editableCount);
  if (indexPath.length < 2) return 0;

  const startPoint = outline[startIdx];
  const endPoint = outline[endIdx];
  const segments = indexPath.length - 1;

  for (let step = 0; step < indexPath.length; step += 1) {
    const t = step / segments;
    const idx = indexPath[step];
    setEditablePoint(outline, idx, {
      x: startPoint.x + (endPoint.x - startPoint.x) * t,
      y: startPoint.y + (endPoint.y - startPoint.y) * t,
    });
  }

  ensureClosedLoop(outline);
  return indexPath.length;
}

function distanceMeters(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function cleanupClosePoints(thresholdMeters) {
  const outline = getCurrentOutline();
  if (!outline) return 0;
  ensureClosedLoop(outline);
  const editableCount = getEditablePointCount(outline);
  if (editableCount < 4) return 0;

  const filtered = [outline[0]];
  for (let i = 1; i < editableCount; i += 1) {
    const current = outline[i];
    const prevKept = filtered[filtered.length - 1];
    if (distanceMeters(current, prevKept) >= thresholdMeters) {
      filtered.push(current);
    }
  }

  while (
    filtered.length > 3 &&
    distanceMeters(filtered[0], filtered[filtered.length - 1]) < thresholdMeters
  ) {
    filtered.pop();
  }

  if (filtered.length < 3) return 0;
  const removed = editableCount - filtered.length;
  outline.length = 0;
  for (let i = 0; i < filtered.length; i += 1) {
    outline.push({ x: filtered[i].x, y: filtered[i].y });
  }
  ensureClosedLoop(outline);
  state.pointIndex = toEditableIndex(state.pointIndex, outline);
  return removed;
}

function applyPushBrush(clickLatLng, { pushHistory = true } = {}) {
  const outline = getCurrentOutline();
  if (!outline) return 0;
  ensureClosedLoop(outline);

  const radiusMeters = readPositiveSliderValue(ui.brushRadius, 0.35);
  const maxPushMeters = readPositiveSliderValue(ui.brushStrength, 0.16);
  const editableCount = getEditablePointCount(outline);
  const clickPointMeters = latLngToMeters(clickLatLng);
  const updates = [];

  for (let idx = 0; idx < editableCount; idx += 1) {
    const point = outline[idx];
    const dx = point.x - clickPointMeters.x;
    const dy = point.y - clickPointMeters.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.000001 || distance > radiusMeters) continue;

    const influence = 1 - distance / radiusMeters;
    const pushDistance = maxPushMeters * influence;
    const nx = dx / distance;
    const ny = dy / distance;

    updates.push({
      idx,
      point: {
        x: point.x + nx * pushDistance,
        y: point.y + ny * pushDistance,
      },
    });
  }

  if (updates.length === 0) return 0;
  if (pushHistory) {
    pushHistorySnapshot();
  }
  for (let i = 0; i < updates.length; i += 1) {
    setEditablePoint(outline, updates[i].idx, updates[i].point);
  }
  ensureClosedLoop(outline);
  renderMap();
  return updates.length;
}

function handleSnapPointSelection(idx) {
  if (state.snapPointIndices.length === 0) {
    state.snapPointIndices = [idx];
    renderMap();
    updateStatus(`Snap start point selected: ${idx + 1}. Select end point.`);
    return;
  }

  if (state.snapPointIndices[0] === idx) {
    updateStatus("Pick a different end point.");
    return;
  }

  state.snapPointIndices = [state.snapPointIndices[0], idx];
  pushHistorySnapshot();
  const changed = snapRangeEvenlyBetween(
    state.snapPointIndices[0],
    state.snapPointIndices[1]
  );
  setSnapMode(false);
  renderMap();
  updateStatus(`Snapped ${changed} points onto a straight, equally spaced line.`);
}

function finishBoxSelection(endLatLng) {
  if (!state.boxSelectStartLatLng || !state.currentEditableLatLngs.length) return;
  const bounds = L.latLngBounds(state.boxSelectStartLatLng, endLatLng);
  const selected = [];
  for (let i = 0; i < state.currentEditableLatLngs.length; i += 1) {
    const latlng = state.currentEditableLatLngs[i];
    if (bounds.contains(latlng)) {
      selected.push(i);
    }
  }

  state.selectedPointIndices = selected;
  state.boxSelectActive = false;
  state.boxSelectStartLatLng = null;
  if (layers.boxSelectRect) {
    map.removeLayer(layers.boxSelectRect);
    layers.boxSelectRect = null;
  }
  map.dragging.enable();
  renderMap();
  updateStatus(`Box selected ${selected.length} point(s).`);
}

map.on("click", (event) => {
  if (Date.now() < ignoreMapClicksUntil) {
    return;
  }
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }
  if (state.snapMode) return;

  if (!state.addMode) return;
  const outline = getCurrentOutline();
  if (!outline) return;

  ensureClosedLoop(outline);
  pushHistorySnapshot();
  const meters = latLngToMeters(event.latlng);
  const editableCount = getEditablePointCount(outline);
  const insertAt = state.pointIndex == null ? editableCount : state.pointIndex + 1;
  outline.splice(insertAt, 0, { x: meters.x, y: meters.y });
  ensureClosedLoop(outline);
  state.pointIndex = insertAt;
  renderMap();
  updateStatus(`Inserted point at position ${insertAt + 1}.`);
});

map.on("mousedown", (event) => {
  if (state.brushMode) {
    if (event.originalEvent?.button != null && event.originalEvent.button !== 0) {
      return;
    }
    if (!state.rawMap) {
      updateStatus("Load a map first.");
      return;
    }
    updateBrushCursorPreview(event.latlng);
    state.brushPainting = true;
    state.brushStrokeMovedCount = 0;
    pushHistorySnapshot();
    map.dragging.disable();

    const moved = applyPushBrush(event.latlng, { pushHistory: false });
    state.brushStrokeMovedCount += moved;
    return;
  }

  if (!state.multiSelectMode) return;
  if (!event.originalEvent?.shiftKey) return;
  state.boxSelectActive = true;
  state.boxSelectStartLatLng = event.latlng;
  map.dragging.disable();
  if (layers.boxSelectRect) {
    map.removeLayer(layers.boxSelectRect);
  }
  layers.boxSelectRect = L.rectangle(
    L.latLngBounds(event.latlng, event.latlng),
    {
      color: "#22d3ee",
      weight: 1,
      fillOpacity: 0.12,
      dashArray: "4,4",
    }
  ).addTo(map);
});

map.on("mousemove", (event) => {
  if (state.brushMode) {
    updateBrushCursorPreview(event.latlng);
    if (state.brushPainting) {
      const moved = applyPushBrush(event.latlng, { pushHistory: false });
      state.brushStrokeMovedCount += moved;
    }
    return;
  }

  if (!state.boxSelectActive || !state.boxSelectStartLatLng) return;
  if (!layers.boxSelectRect) return;
  layers.boxSelectRect.setBounds(L.latLngBounds(state.boxSelectStartLatLng, event.latlng));
});

map.on("mouseup", (event) => {
  if (state.brushMode && state.brushPainting) {
    state.brushPainting = false;
    map.dragging.enable();
    suppressNextMapClick = true;
    ignoreMapClicksUntil = Date.now() + 200;
    updateStatus(
      state.brushStrokeMovedCount > 0
        ? `Push brush moved ${state.brushStrokeMovedCount} point changes.`
        : "Push brush hit no points. Try larger radius."
    );
    return;
  }

  if (!state.boxSelectActive) return;
  finishBoxSelection(event.latlng);
});

map.on("mouseout", () => {
  if (!state.brushMode) return;
  if (state.brushPainting) {
    state.brushPainting = false;
    map.dragging.enable();
  }
});

ui.removePoint.addEventListener("click", () => {
  const outline = getCurrentOutline();
  if (!outline || state.pointIndex == null) {
    updateStatus("Select a point first.");
    return;
  }
  ensureClosedLoop(outline);
  const editableCount = getEditablePointCount(outline);
  if (editableCount <= 3) {
    updateStatus("Need at least 3 border points for a valid closed area.");
    return;
  }
  pushHistorySnapshot();
  outline.splice(state.pointIndex, 1);
  ensureClosedLoop(outline);
  if (getEditablePointCount(outline) === 0) {
    state.pointIndex = null;
  } else if (state.pointIndex >= getEditablePointCount(outline)) {
    state.pointIndex = getEditablePointCount(outline) - 1;
  }
  renderMap();
  updateStatus("Selected point removed.");
});

ui.cleanupPoints.addEventListener("click", () => {
  if (!state.cleanupMode) {
    setCleanupMode(true);
    deactivateEditingModes({ keep: "cleanup" });
    updateStatus("Cleanup tool ON: adjust slider and click 🧹 again to apply.");
    return;
  }

  const thresholdMeters = readPositiveSliderValue(ui.cleanupThreshold, 0.08);
  if (!state.rawMap) {
    updateStatus("Load a map first.");
    return;
  }
  pushHistorySnapshot();
  const removed = cleanupClosePoints(thresholdMeters);
  renderMap();
  updateStatus(`Cleanup finished. Removed ${removed} close point(s).`);
});

ui.saveMapJson.addEventListener("click", async () => {
  if (!state.rawMap) {
    updateStatus("Load a map first.");
    return;
  }
  try {
    await saveMapToServer({ restart: false });
    refreshBackupList().catch(() => {});
    updateStatus("Saved /data/ros/map.json (backup created).");
  } catch (_error) {
    triggerJsonDownload();
    updateStatus("Server save unavailable. Downloaded JSON instead.");
  }
});

ui.saveMapJsonRestart.addEventListener("click", async () => {
  if (!state.rawMap) {
    updateStatus("Load a map first.");
    return;
  }
  try {
    const saveResult = await saveMapToServer({ restart: true });
    refreshBackupList().catch(() => {});
    const containerName = saveResult?.restartContainer || "open_mower_ros";
    if (saveResult?.restartResult?.restarted) {
      updateStatus(
        `Saved /data/ros/map.json, backup created, restarted '${containerName}'.`
      );
    } else if (saveResult?.restartResult?.reason) {
      updateStatus(
        `Saved /data/ros/map.json (backup created). Restart skipped: ${saveResult.restartResult.reason}.`
      );
    } else {
      updateStatus("Saved /data/ros/map.json (backup created).");
    }
  } catch (_error) {
    triggerJsonDownload();
    updateStatus("Server save unavailable. Downloaded JSON instead.");
  }
});

ui.backupSelect.addEventListener("change", async () => {
  try {
    await loadSelectedBackup();
  } catch (_error) {
    updateStatus("Failed to load selected map file.");
  }
});

ui.applyProjection.addEventListener("click", () => {
  const lat = Number(ui.originLat.value);
  const lng = Number(ui.originLng.value);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    updateStatus("Invalid origin coordinates.");
    return;
  }
  pushHistorySnapshot();
  state.originLat = lat;
  state.originLng = lng;
  persistEditorMeta();
  renderMap();
  fitCurrentArea();
  updateStatus("Projection updated.");
});

ui.undoEdit.addEventListener("click", () => {
  if (history.undoStack.length === 0 || !state.rawMap) {
    updateStatus("Nothing to undo.");
    return;
  }
  history.redoStack.push({
    rawMap: cloneMapData(state.rawMap),
    areaIndex: state.areaIndex,
    pointIndex: state.pointIndex,
    originLat: state.originLat,
    originLng: state.originLng,
  });
  const previous = history.undoStack.pop();
  restoreSnapshot(previous);
  updateStatus("Undo applied.");
});

ui.redoEdit.addEventListener("click", () => {
  if (history.redoStack.length === 0 || !state.rawMap) {
    updateStatus("Nothing to redo.");
    return;
  }
  history.undoStack.push({
    rawMap: cloneMapData(state.rawMap),
    areaIndex: state.areaIndex,
    pointIndex: state.pointIndex,
    originLat: state.originLat,
    originLng: state.originLng,
  });
  const next = history.redoStack.pop();
  restoreSnapshot(next);
  updateStatus("Redo applied.");
});

syncSliderLabels();
refreshToolUi();
applyTileLayer();

fetch("./api/params")
  .then((res) => (res.ok ? res.json() : Promise.reject(new Error("No params found."))))
  .then((params) => {
    if (Number.isFinite(params.datumLat) && Number.isFinite(params.datumLng)) {
      state.originLat = params.datumLat;
      state.originLng = params.datumLng;
      ui.originLat.value = String(state.originLat);
      ui.originLng.value = String(state.originLng);
    }
  })
  .catch(() => {});

fetch("./api/map")
  .then((res) => (res.ok ? res.text() : Promise.reject(new Error("No map found."))))
  .then((text) => {
    loadMapFromText(text);
    updateStatus("Loaded /data/ros/map.json.");
    return refreshBackupList().catch(() => {});
  })
  .catch(() => {
    refreshBackupList().catch(() => {});
    updateStatus("Load a map to begin.");
  });
