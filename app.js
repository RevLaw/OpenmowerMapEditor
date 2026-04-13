const state = {
  rawMap: null,
  areaIndex: 0,
  pointIndex: null,
  multiSelectMode: false,
  selectedPointIndices: [],
  addMode: false,
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
  toggleSnap: document.getElementById("toggleSnap"),
  cleanupThreshold: document.getElementById("cleanupThreshold"),
  cleanupPoints: document.getElementById("cleanupPoints"),
  removePoint: document.getElementById("removePoint"),
  saveToMower: document.getElementById("saveToMower"),
  downloadJson: document.getElementById("downloadJson"),
  status: document.getElementById("status"),
  originLat: document.getElementById("originLat"),
  originLng: document.getElementById("originLng"),
  applyProjection: document.getElementById("applyProjection"),
};

function updateStatus(message) {
  ui.status.textContent = message;
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

function setAddMode(enabled) {
  state.addMode = enabled;
  ui.toggleAdd.textContent = `Add point: ${enabled ? "ON" : "OFF"}`;
}

function setMultiSelectMode(enabled) {
  state.multiSelectMode = enabled;
  ui.toggleMultiSelect.textContent = `Multi-select: ${enabled ? "ON" : "OFF"}`;
  if (!enabled) {
    state.selectedPointIndices = [];
  }
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
  state.snapMode = false;
  state.snapPointIndices = [];
  setMultiSelectMode(false);
  ui.toggleAdd.textContent = "Add point: OFF";
  ui.toggleSnap.textContent = "Snap line: OFF";
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

async function saveMapToMower() {
  if (!state.rawMap) {
    updateStatus("Load a map first.");
    return;
  }

  persistEditorMeta();
  ui.saveToMower.disabled = true;
  ui.saveToMower.textContent = "Saving...";

  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state.rawMap),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Save failed with HTTP ${response.status}`);
    }
    const backupHint = result.backup_path ? ` Backup: ${result.backup_path}` : "";
    updateStatus(`Saved map to mower.${backupHint}`);
  } catch (error) {
    updateStatus(`Save failed: ${error.message}`);
  } finally {
    ui.saveToMower.disabled = false;
    ui.saveToMower.textContent = "Save to mower";
  }
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
    setAddMode(false);
    state.snapMode = false;
    state.snapPointIndices = [];
    ui.toggleSnap.textContent = "Snap line: OFF";
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
    state.snapMode = false;
    state.snapPointIndices = [];
    ui.toggleSnap.textContent = "Snap line: OFF";
  }
  updateStatus(
    state.addMode
      ? "Add mode ON: click map to insert a point."
      : "Add mode OFF."
  );
});

ui.toggleSnap.addEventListener("click", () => {
  state.snapMode = !state.snapMode;
  state.snapPointIndices = [];
  if (state.snapMode) {
    setAddMode(false);
    setMultiSelectMode(false);
  }
  ui.toggleSnap.textContent = `Snap line: ${state.snapMode ? "ON" : "OFF"}`;
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
  state.snapMode = false;
  state.snapPointIndices = [];
  ui.toggleSnap.textContent = "Snap line: OFF";
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
  if (!state.boxSelectActive || !state.boxSelectStartLatLng) return;
  if (!layers.boxSelectRect) return;
  layers.boxSelectRect.setBounds(L.latLngBounds(state.boxSelectStartLatLng, event.latlng));
});

map.on("mouseup", (event) => {
  if (!state.boxSelectActive) return;
  finishBoxSelection(event.latlng);
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
  const threshold = Number(ui.cleanupThreshold.value);
  const thresholdMeters =
    Number.isFinite(threshold) && threshold > 0 ? threshold : 0.08;
  if (!state.rawMap) {
    updateStatus("Load a map first.");
    return;
  }
  pushHistorySnapshot();
  const removed = cleanupClosePoints(thresholdMeters);
  renderMap();
  updateStatus(`Cleanup finished. Removed ${removed} close point(s).`);
});

ui.saveToMower.addEventListener("click", () => {
  saveMapToMower();
});

ui.downloadJson.addEventListener("click", () => {
  if (!state.rawMap) {
    updateStatus("Load a map first.");
    return;
  }
  try {
    const response = await fetch("./api/map", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state.rawMap),
    });
    if (!response.ok) {
      throw new Error("Server save failed");
    }
    updateStatus("Saved /data/ros/map.json (backup created).");
  } catch (_error) {
    triggerJsonDownload();
    updateStatus("Server save unavailable. Downloaded JSON instead.");
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
  })
  .catch(() => {
    updateStatus("Load a map to begin.");
  });
