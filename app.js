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
  robotLive: false,
};
const EDITOR_META_KEY = "__editor";
const DEFAULT_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const map = L.map("map").setView([52.52, 13.405], 19);
let baseLayer = null;

const layers = {
  areaLine: null,
  exclusionLines: [],
  pointMarkers: [],
  multiDragMarker: null,
  dockingMarker: null,
  snapGuideLine: null,
  boxSelectRect: null,
  brushCursor: null,
  robotMarker: null,
};

const ROBOT_POLL_MS = 1000;
let robotPoseTimer = null;
let robotPoseFailCount = 0;
let robotPosePollInFlight = false;

const history = {
  undoStack: [],
  redoStack: [],
};
let suppressNextMapClick = false;
let ignoreMapClicksUntil = 0;

const ui = {
  themeToggle: document.getElementById("themeToggle"),
  file: document.getElementById("jsonFile"),
  areaSelect: document.getElementById("areaSelect"),
  zoneTypeSelect: document.getElementById("zoneTypeSelect"),
  addZone: document.getElementById("addZone"),
  removeZone: document.getElementById("removeZone"),
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
  toggleRobotLive: document.getElementById("toggleRobotLive"),
  robotLiveReadout: document.getElementById("robotLiveReadout"),
};

const THEME_STORAGE_KEY = "openmower-map-editor-theme";
const ROBOT_LIVE_STORAGE_KEY = "openmower-map-editor-robot-live";

const robotLiveGate = {
  paramsAttemptDone: false,
  mapAttemptDone: false,
};

function syncRobotLiveButtonUi() {
  if (!ui.toggleRobotLive) return;
  ui.toggleRobotLive.setAttribute("aria-pressed", state.robotLive ? "true" : "false");
  ui.toggleRobotLive.classList.toggle("is-active", state.robotLive);
}

function persistRobotLivePreference() {
  localStorage.setItem(ROBOT_LIVE_STORAGE_KEY, state.robotLive ? "1" : "0");
}

function applyRobotLiveFromStorage() {
  if (!ui.toggleRobotLive) return;
  state.robotLive = localStorage.getItem(ROBOT_LIVE_STORAGE_KEY) === "1";
  syncRobotLiveButtonUi();
}

function tryRobotLiveAfterDeps() {
  if (!robotLiveGate.paramsAttemptDone || !robotLiveGate.mapAttemptDone) return;
  if (state.robotLive && !document.hidden) {
    startRobotLivePolling();
  }
}

function markParamsDepsDone() {
  robotLiveGate.paramsAttemptDone = true;
  tryRobotLiveAfterDeps();
}

function markMapDepsDone() {
  robotLiveGate.mapAttemptDone = true;
  tryRobotLiveAfterDeps();
}

function refreshRobotPoseIfLive() {
  if (!state.robotLive || document.hidden) return;
  pollRobotPoseOnce();
}

function updateStatus(message) {
  ui.status.textContent = message;
}

function getCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function setTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", normalized);
  if (ui.themeToggle) {
    const iconName = normalized === "light" ? "dark_mode" : "light_mode";
    ui.themeToggle.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${iconName}</span>`;
    ui.themeToggle.title =
      normalized === "light" ? "Switch to dark mode" : "Switch to light mode";
  }
}

function initializeTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") {
    setTheme(saved);
    return;
  }
  setTheme("dark");
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

function getCurrentArea() {
  if (!state.rawMap?.areas?.length) return null;
  return state.rawMap.areas[state.areaIndex];
}

function getAreaType(area) {
  return area?.properties?.type || "area";
}

function generateZoneId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultZoneOutlineMeters() {
  const center = latLngToMeters(map.getCenter());
  const halfSizeMeters = 0.8;
  return [
    { x: center.x - halfSizeMeters, y: center.y - halfSizeMeters },
    { x: center.x + halfSizeMeters, y: center.y - halfSizeMeters },
    { x: center.x + halfSizeMeters, y: center.y + halfSizeMeters },
    { x: center.x - halfSizeMeters, y: center.y + halfSizeMeters },
    { x: center.x - halfSizeMeters, y: center.y - halfSizeMeters },
  ];
}

function getAreaCentroidMeters(area) {
  const outline = area?.outline;
  if (!outline?.length) return null;
  let x = 0;
  let y = 0;
  for (let i = 0; i < outline.length; i += 1) {
    x += outline[i].x;
    y += outline[i].y;
  }
  return { x: x / outline.length, y: y / outline.length };
}

function isPointInsidePolygon(point, polygon) {
  if (!point || !polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function getPolygonArea(polygon) {
  if (!polygon || polygon.length < 3) return Number.POSITIVE_INFINITY;
  let areaTwice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const j = (i + 1) % polygon.length;
    areaTwice += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
  }
  return Math.abs(areaTwice) / 2;
}

function getBestContainingMowAreaIndexForPoint(point) {
  if (!state.rawMap?.areas?.length || !point) return null;
  let bestIndex = null;
  let bestAreaSize = Number.POSITIVE_INFINITY;
  for (let i = 0; i < state.rawMap.areas.length; i += 1) {
    const area = state.rawMap.areas[i];
    if (getAreaType(area) !== "mow" || !area.outline?.length) continue;
    if (!isPointInsidePolygon(point, area.outline)) continue;
    const areaSize = getPolygonArea(area.outline);
    if (areaSize < bestAreaSize) {
      bestAreaSize = areaSize;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function getLinkedExclusionAreasForMowArea(mowArea) {
  if (!state.rawMap?.areas?.length || !mowArea?.outline?.length) return [];
  return state.rawMap.areas.filter((area) => {
    if (getAreaType(area) !== "obstacle") return false;
    const centroid = getAreaCentroidMeters(area);
    return isPointInsidePolygon(centroid, mowArea.outline);
  });
}

function getLinkedMowAreaIndexForObstacle(obstacleArea) {
  if (!state.rawMap?.areas?.length || !obstacleArea?.outline?.length) return null;
  const centroid = getAreaCentroidMeters(obstacleArea);
  return getBestContainingMowAreaIndexForPoint(centroid);
}

function getLinkedMowAreaForObstacle(obstacleArea) {
  const linkedIndex = getLinkedMowAreaIndexForObstacle(obstacleArea);
  if (linkedIndex == null) return null;
  return state.rawMap?.areas?.[linkedIndex] || null;
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
  layers.exclusionLines.forEach((line) => map.removeLayer(line));
  layers.exclusionLines = [];
  layers.pointMarkers.forEach((m) => map.removeLayer(m));
  layers.pointMarkers = [];
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

/** Fallback if API predates server `visualMode`. */
function deriveClientRobotVisualMode(health, telemetry) {
  if (health === "emergency") {
    return "emergency";
  }
  if (health === "error") {
    return "error";
  }
  if (!telemetry || typeof telemetry !== "object") {
    return "nav";
  }
  const stateRaw = String(telemetry.stateName ?? "");
  const stateUp = stateRaw.toUpperCase().replace(/\s+/g, "_");
  const docking =
    /(GOING_TO_DOCK|RETURN_TO_DOCK|NAV_TO_DOCK|DOCKING|APPROACH_DOCK|DOCK_NAV|FIND_DOCK|SEARCH_DOCK|TO_DOCK)/i.test(
      stateRaw
    ) && !/UNDOCK/i.test(stateRaw);
  if (docking) {
    return "docking";
  }
  if (telemetry.isCharging === true) {
    return "dock_charging";
  }
  const bat = telemetry.batteryPercent;
  if (
    telemetry.isCharging === false &&
    Number.isFinite(bat) &&
    bat >= 88 &&
    /CHARGING_COMPLETE|DOCKED|AT_DOCK|FULL|STANDBY_DOCK|IDLE_DOCK|PARK_DOCK/i.test(stateUp)
  ) {
    return "dock_full";
  }
  return "nav";
}

function resolveRobotVisualMode(ros) {
  if (!ros || typeof ros !== "object") {
    return "nav";
  }
  if (ros.visualMode) {
    return ros.visualMode;
  }
  return deriveClientRobotVisualMode(ros.health, ros.telemetry);
}

function robotVisualToMarkerStyle(visualMode) {
  switch (visualMode) {
    case "emergency":
      return { modifier: "map-marker--robot--emergency", glyph: "emergency_home" };
    case "error":
      return { modifier: "map-marker--robot--error", glyph: "report" };
    case "docking":
      return { modifier: "map-marker--robot--docking", glyph: "ev_station" };
    case "dock_charging":
      return { modifier: "map-marker--robot--dock-charging", glyph: "battery_charging_full" };
    case "dock_full":
      return { modifier: "map-marker--robot--dock-full", glyph: "battery_full" };
    case "nav":
    default:
      return { modifier: "map-marker--robot--nav", glyph: "navigation" };
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Multiline label: power/GPS, mode, extras (mow, temps, emergency flags). */
function buildRobotHudLines(telemetry) {
  if (!telemetry || typeof telemetry !== "object") {
    return [];
  }
  const lines = [];
  const power = [];
  if (Number.isFinite(telemetry.batteryPercent)) {
    power.push(`Batt ${Math.round(telemetry.batteryPercent)}%`);
  }
  if (Number.isFinite(telemetry.gpsQualityPercent)) {
    power.push(`GPS ${Math.round(telemetry.gpsQualityPercent)}%`);
  }
  if (telemetry.isCharging === true) {
    power.push("charging");
  }
  if (power.length) {
    lines.push(power.join(" · "));
  }

  const mode = [];
  if (typeof telemetry.stateName === "string" && telemetry.stateName.trim()) {
    mode.push(telemetry.stateName.replace(/_/g, " "));
  }
  if (typeof telemetry.subStateName === "string" && telemetry.subStateName.trim()) {
    mode.push(telemetry.subStateName.replace(/_/g, " "));
  }
  if (mode.length) {
    lines.push(mode.join(" · "));
  }

  const extra = [];
  if (telemetry.mowEnabled === true) {
    extra.push("mow on");
  } else if (telemetry.mowEnabled === false) {
    extra.push("mow off");
  }
  if (telemetry.rainDetected === true) {
    extra.push("rain");
  }
  if (Number.isFinite(telemetry.escTempC)) {
    extra.push(`ESC ${Math.round(telemetry.escTempC)}°C`);
  }
  if (Number.isFinite(telemetry.mowerMotorRpm)) {
    extra.push(`${Math.round(telemetry.mowerMotorRpm)} RPM`);
  }
  if (telemetry.emergency === true) {
    extra.push("emergency");
  }
  if (telemetry.activeEmergency === true) {
    extra.push("estop active");
  }
  if (telemetry.latchedEmergency === true) {
    extra.push("latched");
  }
  if (typeof telemetry.emergencyReason === "string" && telemetry.emergencyReason.trim()) {
    extra.push(telemetry.emergencyReason.trim().slice(0, 40));
  }
  if (extra.length) {
    lines.push(extra.join(" · "));
  }

  return lines;
}

function buildRobotHudHtml(telemetry) {
  const lines = buildRobotHudLines(telemetry);
  if (!lines.length) {
    return "";
  }
  return lines
    .map((line) => `<div class="robot-marker-hud__line">${escapeHtml(line)}</div>`)
    .join("");
}

function syncRobotLiveReadout(data) {
  if (!ui.robotLiveReadout) {
    return;
  }
  if (!state.robotLive || !data || !data.ok) {
    ui.robotLiveReadout.hidden = true;
    ui.robotLiveReadout.textContent = "";
    return;
  }
  const hudLines = buildRobotHudLines(data.ros && data.ros.telemetry ? data.ros.telemetry : null);
  if (hudLines.length) {
    ui.robotLiveReadout.hidden = false;
    ui.robotLiveReadout.textContent = hudLines.join("\n");
    return;
  }
  if (data.ros && data.ros.summary) {
    ui.robotLiveReadout.hidden = false;
    ui.robotLiveReadout.textContent = data.ros.summary;
    return;
  }
  ui.robotLiveReadout.hidden = false;
  ui.robotLiveReadout.textContent =
    "Map position only — ROS status not received (rostopic may need more time; check OPENMOWER_ROS_TOPIC_TIMEOUT_SEC).";
}

function makeRobotPoseIcon(yawRadians, visualMode, telemetry) {
  const rotationDeg = 90 - (yawRadians * 180) / Math.PI;
  const { modifier, glyph } = robotVisualToMarkerStyle(visualMode);
  const extraClass = modifier ? ` ${modifier}` : "";
  const yawFollowsHeading = visualMode === "nav";
  const yawCss = yawFollowsHeading ? `transform: rotate(${rotationDeg}deg)` : "transform: none";
  const hudInner = buildRobotHudHtml(telemetry);
  if (!hudInner) {
    return L.divIcon({
      className: "map-marker-leaflet",
      html: `<div class="map-marker--robot${extraClass}" style="${yawCss}"><span class="material-symbols-outlined" aria-hidden="true">${glyph}</span></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }
  const stackW = 200;
  const circleR = 20;
  const lineCount = buildRobotHudLines(telemetry).length;
  const hudBodyH = 6 + lineCount * 15;
  const stackH = 40 + 4 + hudBodyH;
  return L.divIcon({
    className: "map-marker-leaflet robot-marker-stack-wrap",
    html: `<div class="robot-marker-stack" style="width:${stackW}px">
  <div class="robot-marker-stack__pin">
    <div class="map-marker--robot${extraClass}" style="${yawCss}"><span class="material-symbols-outlined" aria-hidden="true">${glyph}</span></div>
  </div><div class="robot-marker-stack__hud">${hudInner}</div>
</div>`,
    iconSize: [stackW, stackH],
    iconAnchor: [stackW / 2, circleR],
  });
}

/** Short hover text; full numbers live on the multiline map label + sidebar readout. */
function appendRobotTelemetryTooltipBrief(lines, telemetry) {
  if (!telemetry || typeof telemetry !== "object") {
    return;
  }
  if (Number.isFinite(telemetry.batteryPercent)) {
    lines.push(`Battery ${Math.round(telemetry.batteryPercent)}%`);
  }
  if (Number.isFinite(telemetry.gpsQualityPercent)) {
    lines.push(`GPS ${Math.round(telemetry.gpsQualityPercent)}%`);
  }
  if (telemetry.isCharging === true) {
    lines.push("Power: charging");
  }
  if (telemetry.stateName) {
    lines.push(`Mode: ${telemetry.stateName}`);
  }
}

function buildRobotPoseTooltip(data) {
  const lines = [
    `Robot (${data.frameParent}→${data.frameChild})  x=${data.x.toFixed(2)}m y=${data.y.toFixed(2)}m`,
  ];
  const c = data.container;
  if (c && typeof c === "object") {
    if (c.exists === false) {
      lines.push("Container: not found");
    } else if (c.exists == null) {
      lines.push(`Container: unavailable (${c.status || "?"})`);
    } else if (!c.running || (Number.isFinite(c.restartCount) && c.restartCount > 0)) {
      lines.push(`Container: ${c.running ? "running" : "stopped"} (${c.status || "?"})`);
      if (Number.isFinite(c.restartCount) && c.restartCount > 0) {
        lines.push(`Restarts: ${c.restartCount}`);
      }
    }
  }
  if (data.ros && data.ros.telemetry) {
    appendRobotTelemetryTooltipBrief(lines, data.ros.telemetry);
  }
  if (data.ros) {
    if (data.ros.summary) {
      lines.push(`Status: ${data.ros.summary}`);
    }
    if (data.ros.topic) {
      lines.push(`ROS sample: ${data.ros.topic}`);
    }
  }
  return lines.join("\n");
}

function disableLiveRobotUi(message) {
  state.robotLive = false;
  syncRobotLiveButtonUi();
  persistRobotLivePreference();
  robotPoseFailCount = 0;
  stopRobotLivePolling();
  removeRobotMarker();
  syncRobotLiveReadout(null);
  updateStatus(message);
}

function removeRobotMarker() {
  if (layers.robotMarker) {
    map.removeLayer(layers.robotMarker);
    layers.robotMarker = null;
  }
}

function stopRobotLivePolling() {
  if (robotPoseTimer != null) {
    clearInterval(robotPoseTimer);
    robotPoseTimer = null;
  }
}

async function pollRobotPoseOnce() {
  if (!state.robotLive || document.hidden) {
    return;
  }
  if (robotPosePollInFlight) {
    return;
  }
  robotPosePollInFlight = true;
  try {
    const response = await fetch("./api/robot_pose");
    const data = await response.json();
    if (!data.ok) {
      if (data.liveRobotFatal) {
        disableLiveRobotUi(`Live robot: ${data.error || "unavailable"}`);
        return;
      }
      robotPoseFailCount += 1;
      if (robotPoseFailCount === 1 || robotPoseFailCount % 6 === 0) {
        updateStatus(`Live robot: ${data.error || "unavailable"}`);
      }
      return;
    }
    robotPoseFailCount = 0;
    const latlng = metersToLatLng({ x: data.x, y: data.y });
    const visualMode = resolveRobotVisualMode(data.ros);
    const title = buildRobotPoseTooltip(data);
    if (!layers.robotMarker) {
      layers.robotMarker = L.marker(latlng, {
        icon: makeRobotPoseIcon(
          data.yaw,
          visualMode,
          data.ros && data.ros.telemetry ? data.ros.telemetry : null
        ),
        zIndexOffset: 800,
      })
        .bindTooltip(title, {
          sticky: true,
          direction: "top",
          opacity: 0.95,
          className: "robot-tooltip",
        })
        .addTo(map);
    } else {
      layers.robotMarker.setLatLng(latlng);
      layers.robotMarker.setIcon(
        makeRobotPoseIcon(
          data.yaw,
          visualMode,
          data.ros && data.ros.telemetry ? data.ros.telemetry : null
        )
      );
      layers.robotMarker.setTooltipContent(title);
    }
    syncRobotLiveReadout(data);
  } catch (_error) {
    robotPoseFailCount += 1;
    if (robotPoseFailCount === 1 || robotPoseFailCount % 6 === 0) {
      updateStatus("Live robot: request failed (server or Docker exec).");
    }
  } finally {
    robotPosePollInFlight = false;
  }
}

function startRobotLivePolling() {
  stopRobotLivePolling();
  if (!state.robotLive || document.hidden) {
    return;
  }
  if (!robotLiveGate.paramsAttemptDone || !robotLiveGate.mapAttemptDone) {
    return;
  }
  pollRobotPoseOnce();
  robotPoseTimer = setInterval(pollRobotPoseOnce, ROBOT_POLL_MS);
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
  const currentArea = getCurrentArea();
  const outline = currentArea?.outline;
  if (!outline) return;
  const currentAreaType = getAreaType(currentArea);
  const mowLineColor = getCssVar("--map-line-mow", "#ffffff");
  const obstacleLineColor = getCssVar("--map-line-obstacle", "#ef4444");
  const navLineColor = getCssVar("--map-line-nav", "#0284c7");
  const overlayMowLineColor = getCssVar("--map-line-overlay-mow", mowLineColor);
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
    color:
      currentAreaType === "obstacle"
        ? obstacleLineColor
        : currentAreaType === "nav"
          ? navLineColor
          : mowLineColor,
    weight: currentAreaType === "mow" ? 0.2 : 1.2,
    opacity: 0.95,
    dashArray: currentAreaType === "mow" ? undefined : "4,4",
  }).addTo(map);

  if (currentAreaType === "mow") {
    const overlayAreas = (state.rawMap?.areas || []).filter((area) => {
      const type = getAreaType(area);
      return type === "obstacle" || type === "nav";
    });
    for (let i = 0; i < overlayAreas.length; i += 1) {
      const overlayArea = overlayAreas[i];
      const exclusionOutline = overlayArea.outline || [];
      if (exclusionOutline.length < 2) continue;
      const exclusionLatLngs = exclusionOutline.map(metersToLatLng);
      const exclusionClosed =
        exclusionLatLngs.length > 1 ? [...exclusionLatLngs, exclusionLatLngs[0]] : exclusionLatLngs;
      const type = getAreaType(overlayArea);
      const exclusionLine = L.polyline(exclusionClosed, {
        color: type === "nav" ? navLineColor : obstacleLineColor,
        weight: 1.2,
        opacity: 0.95,
        dashArray: "4,4",
      }).addTo(map);
      layers.exclusionLines.push(exclusionLine);
    }
  } else if (currentAreaType === "obstacle") {
    const overlayAreas = (state.rawMap?.areas || []).filter((area) => {
      const type = getAreaType(area);
      return type === "mow" || type === "nav";
    });
    for (let i = 0; i < overlayAreas.length; i += 1) {
      const overlayArea = overlayAreas[i];
      const overlayOutline = overlayArea.outline || [];
      if (overlayOutline.length < 2) continue;
      const overlayLatLngs = overlayOutline.map(metersToLatLng);
      const overlayClosed = overlayLatLngs.length > 1 ? [...overlayLatLngs, overlayLatLngs[0]] : overlayLatLngs;
      const type = getAreaType(overlayArea);
      const overlayLine = L.polyline(overlayClosed, {
        color: type === "nav" ? navLineColor : overlayMowLineColor,
        weight: 1.2,
        opacity: 0.95,
        dashArray: "4,4",
      }).addTo(map);
      layers.exclusionLines.push(overlayLine);
    }
  } else if (currentAreaType === "nav") {
    const overlayAreas = (state.rawMap?.areas || []).filter((area) => {
      const type = getAreaType(area);
      return type === "mow" || type === "obstacle";
    });
    for (let i = 0; i < overlayAreas.length; i += 1) {
      const overlayArea = overlayAreas[i];
      const overlayOutline = overlayArea.outline || [];
      if (overlayOutline.length < 2) continue;
      const overlayLatLngs = overlayOutline.map(metersToLatLng);
      const overlayClosed = overlayLatLngs.length > 1 ? [...overlayLatLngs, overlayLatLngs[0]] : overlayLatLngs;
      const type = getAreaType(overlayArea);
      const overlayLine = L.polyline(overlayClosed, {
        color: type === "obstacle" ? obstacleLineColor : overlayMowLineColor,
        weight: 1.2,
        opacity: 0.95,
        dashArray: "4,4",
      }).addTo(map);
      layers.exclusionLines.push(overlayLine);
    }
  }

  latlngs.forEach((latlng, idx) => {
    const isSelected = idx === state.pointIndex;
    const isSnapEndpoint = state.snapPointIndices.includes(idx);
    const isMultiSelected = state.selectedPointIndices.includes(idx);
    const isFirstPoint = idx === 0;
    const baseColor = isFirstPoint ? "#22c55e" : "#f59e0b";
    const pointColor = isSnapEndpoint
      ? "#a855f7"
      : isMultiSelected
        ? "#22d3ee"
        : isSelected
          ? "#ef4444"
          : baseColor;
    const markerSize = isSelected ? 11 : 9;
    const markerBorderWidth = isSelected ? 2 : 1;
    const marker = L.marker(latlng, {
      draggable: !state.multiSelectMode && !state.snapMode && !state.addMode,
      icon: L.divIcon({
        className: "",
        html: `<span style="display:block;width:${markerSize}px;height:${markerSize}px;border-radius:50%;background:${pointColor};border:${markerBorderWidth}px solid rgba(15,23,42,0.9);box-shadow:0 0 0 1px rgba(255,255,255,0.35);"></span>`,
        iconSize: [markerSize, markerSize],
        iconAnchor: [markerSize / 2, markerSize / 2],
      }),
      title: "Drag point directly",
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
    marker.on("dragstart", () => {
      state.pointIndex = idx;
      if (state.addMode) {
        setAddMode(false);
      }
      suppressNextMapClick = true;
      ignoreMapClicksUntil = Date.now() + 700;
      pushHistorySnapshot();
    });
    marker.on("dragend", (e) => {
      ignoreMapClicksUntil = Date.now() + 700;
      const meters = latLngToMeters(e.target.getLatLng());
      setEditablePoint(outline, idx, meters);
      ensureClosedLoop(outline);
      state.pointIndex = idx;
      renderMap();
      updateStatus(`Moved point ${idx + 1}.`);
    });
    layers.pointMarkers.push(marker);
  });

  if (state.selectedPointIndices.length > 1) {
    const selectedLatLngs = state.selectedPointIndices.map((idx) =>
      metersToLatLng(editablePoints[idx])
    );
    const centerLat =
      selectedLatLngs.reduce((sum, item) => sum + item[0], 0) / selectedLatLngs.length;
    const centerLng =
      selectedLatLngs.reduce((sum, item) => sum + item[1], 0) / selectedLatLngs.length;

    const groupIcon = L.divIcon({
      className: "map-marker-leaflet",
      html: `<div class="map-marker--group"><span class="material-symbols-outlined" aria-hidden="true">open_with</span></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
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
    className: "map-marker-leaflet",
    html: `<div class="map-marker--dock"><span class="material-symbols-outlined" aria-hidden="true">ev_station</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

  layers.dockingMarker = L.marker(stationLatLng, {
    draggable: true,
    icon: homeIcon,
    title: "Dock / charging station (drag to move)",
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
    updateStatus("Dock / charging station moved.");
  });
}

function refreshAreaSelect() {
  ui.areaSelect.innerHTML = "";
  const areas = state.rawMap?.areas || [];
  if (areas.length === 0) {
    state.areaIndex = 0;
    return;
  }
  state.areaIndex = Math.max(0, Math.min(state.areaIndex, areas.length - 1));
  areas.forEach((area, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    const areaType = getAreaType(area);
    if (areaType === "mow") {
      option.textContent = `${i + 1}: mow (${area.id})`;
    } else if (areaType === "obstacle") {
      option.textContent = `${i + 1}: obstacle (${area.id})`;
    } else {
      option.textContent = `${i + 1}: ${areaType} (${area.id})`;
    }
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
  refreshRobotPoseIfLive();
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

ui.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  setTheme(next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
  if (state.rawMap) {
    renderMap();
  }
});

ui.areaSelect.addEventListener("change", () => {
  const nextIndex = Number(ui.areaSelect.value);
  if (!Number.isFinite(nextIndex)) return;
  state.areaIndex = nextIndex;
  state.pointIndex = null;
  state.selectedPointIndices = [];
  renderMap();
  fitCurrentArea();
});

ui.addZone.addEventListener("click", () => {
  if (!state.rawMap) {
    updateStatus("Load a map first.");
    return;
  }
  if (!Array.isArray(state.rawMap.areas)) {
    state.rawMap.areas = [];
  }
  const zoneType = ui.zoneTypeSelect.value || "mow";
  pushHistorySnapshot();
  state.rawMap.areas.push({
    id: generateZoneId(),
    properties: {
      type: zoneType,
    },
    outline: createDefaultZoneOutlineMeters(),
  });
  state.areaIndex = state.rawMap.areas.length - 1;
  state.pointIndex = 0;
  state.selectedPointIndices = [];
  refreshAreaSelect();
  renderMap();
  fitCurrentArea();
  updateStatus(`Added new ${zoneType} zone.`);
});

ui.removeZone.addEventListener("click", () => {
  if (!state.rawMap?.areas?.length) {
    updateStatus("No zone to remove.");
    return;
  }
  const areaToRemove = getCurrentArea();
  const removedType = getAreaType(areaToRemove);
  pushHistorySnapshot();
  state.rawMap.areas.splice(state.areaIndex, 1);
  state.areaIndex = Math.max(0, Math.min(state.areaIndex, state.rawMap.areas.length - 1));
  state.pointIndex = null;
  state.selectedPointIndices = [];
  refreshAreaSelect();
  renderMap();
  fitCurrentArea();
  updateStatus(`Removed ${removedType} zone.`);
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

function startBrushStroke(latlng) {
  if (!state.rawMap) {
    updateStatus("Load a map first.");
    return false;
  }
  updateBrushCursorPreview(latlng);
  state.brushPainting = true;
  state.brushStrokeMovedCount = 0;
  pushHistorySnapshot();
  map.dragging.disable();
  const moved = applyPushBrush(latlng, { pushHistory: false });
  state.brushStrokeMovedCount += moved;
  return true;
}

function continueBrushStroke(latlng) {
  updateBrushCursorPreview(latlng);
  if (!state.brushPainting) return;
  const moved = applyPushBrush(latlng, { pushHistory: false });
  state.brushStrokeMovedCount += moved;
}

function endBrushStroke() {
  if (!state.brushPainting) return;
  state.brushPainting = false;
  map.dragging.enable();
  suppressNextMapClick = true;
  ignoreMapClicksUntil = Date.now() + 200;
  updateStatus(
    state.brushStrokeMovedCount > 0
      ? `Push brush moved ${state.brushStrokeMovedCount} point changes.`
      : "Push brush hit no points. Try larger radius."
  );
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
    startBrushStroke(event.latlng);
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
    continueBrushStroke(event.latlng);
    return;
  }

  if (!state.boxSelectActive || !state.boxSelectStartLatLng) return;
  if (!layers.boxSelectRect) return;
  layers.boxSelectRect.setBounds(L.latLngBounds(state.boxSelectStartLatLng, event.latlng));
});

map.on("mouseup", (event) => {
  if (state.brushMode && state.brushPainting) {
    endBrushStroke();
    return;
  }

  if (!state.boxSelectActive) return;
  finishBoxSelection(event.latlng);
});

map.on("mouseout", () => {
  if (!state.brushMode) return;
  if (state.brushPainting) {
    endBrushStroke();
  }
});

map.on("touchstart", (event) => {
  if (!state.brushMode) return;
  startBrushStroke(event.latlng);
});

map.on("touchmove", (event) => {
  if (!state.brushMode) return;
  continueBrushStroke(event.latlng);
});

map.on("touchend", () => {
  if (!state.brushMode || !state.brushPainting) return;
  endBrushStroke();
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
  refreshRobotPoseIfLive();
});

function applyUndo() {
  if (history.undoStack.length === 0 || !state.rawMap) {
    updateStatus("Nothing to undo.");
    return false;
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
  return true;
}

function applyRedo() {
  if (history.redoStack.length === 0 || !state.rawMap) {
    updateStatus("Nothing to redo.");
    return false;
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
  return true;
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

ui.undoEdit.addEventListener("click", () => {
  applyUndo();
});

ui.redoEdit.addEventListener("click", () => {
  applyRedo();
});

document.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.key.toLowerCase() !== "z" && event.key.toLowerCase() !== "y") return;

  if (event.key.toLowerCase() === "z" && !event.shiftKey) {
    if (applyUndo()) {
      event.preventDefault();
    }
    return;
  }

  if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") {
    if (applyRedo()) {
      event.preventDefault();
    }
  }
});

if (ui.toggleRobotLive) {
  ui.toggleRobotLive.addEventListener("click", () => {
    state.robotLive = !state.robotLive;
    syncRobotLiveButtonUi();
    persistRobotLivePreference();
    robotPoseFailCount = 0;
    if (state.robotLive) {
      if (robotLiveGate.paramsAttemptDone && robotLiveGate.mapAttemptDone) {
        startRobotLivePolling();
        updateStatus("Live robot on (ROS TF via Docker).");
      } else {
        updateStatus("Live robot will start after map and projection finish loading.");
      }
    } else {
      stopRobotLivePolling();
      removeRobotMarker();
      syncRobotLiveReadout(null);
      updateStatus("Live robot overlay off.");
    }
  });
  applyRobotLiveFromStorage();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRobotLivePolling();
    return;
  }
  if (state.robotLive && robotLiveGate.paramsAttemptDone && robotLiveGate.mapAttemptDone) {
    startRobotLivePolling();
  }
});

window.addEventListener("pagehide", () => {
  stopRobotLivePolling();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) {
    return;
  }
  if (state.robotLive && !document.hidden && robotLiveGate.paramsAttemptDone && robotLiveGate.mapAttemptDone) {
    startRobotLivePolling();
  }
});

syncSliderLabels();
refreshToolUi();
initializeTheme();
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
    refreshRobotPoseIfLive();
  })
  .catch(() => {})
  .finally(() => {
    markParamsDepsDone();
  });

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
  })
  .finally(() => {
    markMapDepsDone();
  });
