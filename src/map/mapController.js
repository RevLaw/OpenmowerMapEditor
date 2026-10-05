import L from "leaflet";
import { get } from "svelte/store";
import { metersToLatLng, latLngToMeters } from "../lib/geo/projection.js";
import { getAreaType, getZoneOverrides, getZoneName } from "../lib/format/mapFormat.js";
import {
  nearestEdgeInsertIndex,
  distance,
  centroid,
  isPointInsidePolygon,
  offsetPolygon,
  polygonArea,
  simplify,
  boundingBox,
} from "../lib/geo/geometry.js";
import { coverageLines } from "../lib/geo/coverage.js";
import { resolveMowSettings } from "../lib/coverage/mowSettings.js";
import { rectangleOutline, circleOutline } from "../lib/format/shapes.js";
import { getEditablePoints } from "../lib/format/outline.js";
import { magnetSnap } from "../lib/geo/tools/magnet.js";
import {
  editor,
  currentEditablePoints,
  selectPoint,
  clearSelection,
  toggleMultiPoint,
  setMultiSelection,
  movePoint,
  movePointsBy,
  insertPointAtIndex,
  addZoneFromPoints,
  moveDock,
  setDock,
  setSnapPoints,
  snapBetween,
  applyBrushSteps,
  pushHistory,
  setAreaIndex,
} from "../lib/stores/editor.js";
import {
  activeTool,
  brushRadius,
  brushStrength,
  drawZoneType,
  coverageOn,
  snapEnabled,
  SNAP_TOLERANCE_PX,
  simplifyTolerance,
  simplifyPreviewOn,
  polyDraftCount,
  rulerInfo,
} from "../lib/stores/tools.js";
import { hiddenZones, lockedZones, zoneKey, toggleZoneHidden, toggleZoneLocked } from "../lib/stores/zoneView.js";
import { contextMenu, sidebarTab, editMode, followRobot } from "../lib/stores/ui.js";
import { recording } from "../lib/stores/recorder.js";
import { trailZonePath, trailZoneOutline } from "../lib/stores/trailZone.js";
import {
  removePoint,
  makeStartPoint,
  duplicateZoneAction,
  removeCurrentZone,
  changeZoneType,
  splitCurrentZone,
  addZoneAtCenter,
  setDockFromRobot,
  removeDockAction,
  setDockExact,
  guardEditable,
} from "../lib/actions.js";
import { formatArea, formatLength } from "../lib/measurements.js";
import { mowParams } from "../lib/stores/mowParams.js";
import { robotLive, robotPose } from "../lib/stores/robot.js";
import { exactPath } from "../lib/stores/exactPath.js";
import { wifiOverlayEnabled, wifiSamples, wifiCellSizeM } from "../lib/stores/wifi.js";
import {
  robotTrailEnabled,
  robotTrail,
  robotTrailHistoryEnabled,
  robotTrailDisplayPoints,
} from "../lib/stores/robotTrail.js";
import { wifiSignalColor } from "../lib/wifi/signal.js";
import {
  resolveRobotVisualMode,
  robotVisualToMarkerStyle,
  buildRobotHudLines,
  buildRobotPoseTooltip,
  escapeHtml,
} from "../lib/robot/telemetry.js";
import { poseDist2, stepPose } from "../lib/robot/interpolate.js";
import { notify, setStatus } from "../lib/stores/toast.js";
import { activeBasemap } from "../lib/stores/basemap.js";

// Top-down robot mower, pointing "up" by default so applyRobotTransform's
// rotate(90 - yaw) maps heading correctly (yaw 0 = east). Filled nose = front;
// centre disc + cross = the cutting blade. White strokes read on any basemap.
const ROBOT_MOWER_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M12 2.4 L15.6 6.6 H8.4 Z" fill="#fff" stroke="none"/><rect x="5.8" y="6.4" width="12.4" height="12.9" rx="3.8"/><circle cx="12" cy="13" r="3.3"/><path d="M12 9.7 v6.6 M8.7 13 h6.6" stroke-width="1.3"/></svg>`;

/** Marker inner content: the mower SVG while driving/mowing, else the status glyph. */
function robotGlyphInner(visual, glyph) {
  const inner =
    visual === "nav"
      ? ROBOT_MOWER_SVG
      : `<span class="material-symbols-outlined">${glyph}</span>`;
  return `<span class="robot-glyph">${inner}</span>`;
}

function cssVar(name, fallback) {
  if (typeof getComputedStyle === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function buildTileLayer(cfg) {
  const opts = {
    minZoom: 1,
    maxNativeZoom: cfg.maxNativeZoom ?? 20,
    maxZoom: cfg.maxZoom ?? 23,
    attribution: cfg.attribution || "",
  };
  if (cfg.type === "wms") {
    return L.tileLayer.wms(cfg.url, {
      ...opts,
      layers: cfg.layers || "",
      format: cfg.format || "image/png",
      transparent: false,
      version: cfg.version || "1.3.0",
    });
  }
  if (cfg.subdomains) opts.subdomains = cfg.subdomains;
  return L.tileLayer(cfg.url, opts);
}

export function createMapController(container) {
  // Native zoom control is hidden behind the sidebar (top-left); we render our
  // own glass zoom buttons instead (see ZoomControl.svelte).
  // tapHold: long-press opens the context menu on every touch browser, not
  // just mobile Safari (Leaflet's default).
  // boxZoom off: Shift+drag is the select tool's box selection.
  const map = L.map(container, { zoomControl: false, maxZoom: 24, tapHold: true, boxZoom: false }).setView(
    [52.52, 13.405],
    19
  );
  map.createPane("wifiHeatPane");
  const wifiPane = map.getPane("wifiHeatPane");
  wifiPane.style.zIndex = "350";
  wifiPane.style.pointerEvents = "none";
  wifiPane.style.filter = "blur(5px) saturate(1.25)";
  const wifiRenderer = L.canvas({ pane: "wifiHeatPane", padding: 0.5 });

  let baseLayer = null;
  function applyBasemap(cfg) {
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = buildTileLayer(cfg).addTo(map);
    baseLayer.bringToBack();
    map.setMaxZoom(cfg.maxZoom ?? 23);
  }

  const layers = {
    areaLine: null,
    zones: [],
    points: [],
    midpoints: [],
    snapIndicator: null,
    poly: null,
    ruler: null,
    split: null,
    recording: null,
    trailZone: null,
    simplifyPreview: null,
    multiHandle: null,
    snapGuide: null,
    boxSelect: null,
    brushCursor: null,
    drawPreview: null,
    coverage: [],
    dock: null,
    robot: null,
    exactPath: null,
    wifiHeat: [],
    robotTrail: [],
    robotTrailHistory: [],
  };

  // Local mirror of state read inside imperative handlers.
  let s = get(editor);
  let tool = get(activeTool);

  // Interaction guards (ported from app.js).
  let suppressNextClick = false;
  let ignoreClicksUntil = 0;
  let brushPainting = false;
  let brushMoved = 0;
  let brushCursorLatLng = null;
  let brushPrev = null;
  let boxActive = false;
  let boxStart = null;
  let drawActive = false;
  let drawStart = null;
  // Multi-click tools (meters): polygon draft, ruler points, split start.
  let polyPts = [];
  let rulerPts = [];
  let splitStart = null;
  let hoverMeters = null;
  // Alt held = bypass magnetic snapping for this drag / click.
  let altHeld = false;
  let hidden = get(hiddenZones);
  let locked = get(lockedZones);
  let snapOn = get(snapEnabled);
  // View mode (editing off): zones, robot and trail only — no handles / menus.
  let editing = get(editMode);
  // Preview latlngs of the selected outline, patched live while dragging.
  let previewLatLngs = [];
  // Selected-zone points as last drawn (lets a brush stroke patch, not rebuild).
  let renderedPts = [];

  const origin = () => s.origin;
  const toLatLng = (p) => metersToLatLng(p, origin());

  // ---- helpers -------------------------------------------------------------

  function zoneHiddenAt(i) {
    const a = s.mapData?.areas?.[i];
    return Boolean(a && hidden.has(zoneKey(a, i)));
  }

  function currentIsLocked() {
    const a = s.mapData?.areas?.[s.areaIndex];
    return Boolean(a && locked.has(zoneKey(a, s.areaIndex)));
  }

  /** Ground meters per screen pixel at the current zoom/center. */
  function metersPerPixel() {
    const lat = map.getCenter().lat;
    return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom() + 8);
  }

  /** Visible zone rings (open point arrays), optionally excluding one zone. */
  function snapRings(excludeIndex) {
    const rings = [];
    (s.mapData?.areas || []).forEach((a, i) => {
      if (i === excludeIndex || zoneHiddenAt(i)) return;
      const pts = getEditablePoints(a.outline || []);
      if (pts.length >= 2) rings.push(pts);
    });
    return rings;
  }

  /**
   * Magnetic snap for a point being placed/dragged. Returns
   * { point, snapped: null | 'vertex' | 'edge' }.
   */
  function snapMeters(meters, { exclude = null, extra = [], event = null } = {}) {
    if (!snapOn || altHeld || event?.altKey) return { point: meters, snapped: null };
    const dock = s.mapData?.docking_stations?.[0]?.position;
    const hit = magnetSnap(
      meters,
      snapRings(exclude),
      SNAP_TOLERANCE_PX * metersPerPixel(),
      dock ? [...extra, dock] : extra
    );
    return hit ? { point: hit.point, snapped: hit.kind } : { point: meters, snapped: null };
  }

  function showSnapIndicator(meters, kind) {
    const ll = toLatLng(meters);
    if (!layers.snapIndicator) {
      layers.snapIndicator = L.circleMarker(ll, {
        radius: 8,
        color: "#f0abfc",
        weight: 2,
        fill: false,
        interactive: false,
      }).addTo(map);
    }
    layers.snapIndicator.setLatLng(ll);
    layers.snapIndicator.setStyle({ dashArray: kind === "edge" ? "3,3" : undefined });
  }

  function hideSnapIndicator() {
    if (layers.snapIndicator) {
      map.removeLayer(layers.snapIndicator);
      layers.snapIndicator = null;
    }
  }

  function openMenu(e, title, items) {
    const oe = e.originalEvent || e;
    if (oe?.preventDefault) oe.preventDefault();
    if (!editing) return; // view mode: no editing menus
    if (e.originalEvent) L.DomEvent.stopPropagation(e);
    contextMenu.set({ x: oe.clientX ?? 0, y: oe.clientY ?? 0, title, items });
  }

  // ---- rendering -----------------------------------------------------------

  function clearEditLayers() {
    if (layers.areaLine) map.removeLayer(layers.areaLine);
    layers.areaLine = null;
    layers.zones.forEach((l) => map.removeLayer(l));
    layers.zones = [];
    layers.midpoints.forEach((m) => map.removeLayer(m));
    layers.midpoints = [];
    if (layers.simplifyPreview) map.removeLayer(layers.simplifyPreview);
    layers.simplifyPreview = null;
    layers.coverage.forEach((l) => map.removeLayer(l));
    layers.coverage = [];
    layers.points.forEach((m) => map.removeLayer(m));
    layers.points = [];
    if (layers.multiHandle) map.removeLayer(layers.multiHandle);
    layers.multiHandle = null;
    if (layers.snapGuide) map.removeLayer(layers.snapGuide);
    layers.snapGuide = null;
    if (layers.dock) map.removeLayer(layers.dock);
    layers.dock = null;
  }

  // Tools during which zone shapes take clicks (select / context menu). For
  // drawing and placing tools they stay transparent so clicks reach the map.
  const ZONE_PICK_TOOLS = ["none"];
  const PLACE_TOOLS = ["poly", "rect", "circle", "dock", "ruler", "split"];

  function zoneStyle(type, selected) {
    const mowColor = cssVar("--map-line-mow", "#ffffff");
    const obstacleColor = cssVar("--map-line-obstacle", "#ef4444");
    const navColor = cssVar("--map-line-nav", "#38bdf8");
    if (type === "obstacle") {
      return { color: obstacleColor, fillColor: obstacleColor, fillOpacity: selected ? 0.3 : 0.18, weight: selected ? 2.2 : 1.4 };
    }
    if (type === "nav") {
      return { color: navColor, fillColor: navColor, fillOpacity: selected ? 0.16 : 0.07, weight: selected ? 2.2 : 1.4, dashArray: "6,4" };
    }
    return { color: mowColor, fillColor: "#22c55e", fillOpacity: selected ? 0.16 : 0.07, weight: selected ? 2.2 : 1.2 };
  }

  /** Draw every visible zone (selected one highlighted); others are click-to-select. */
  function renderZones() {
    const areas = s.mapData?.areas || [];
    const pickable = ZONE_PICK_TOOLS.includes(tool);
    // Mow first, then nav, obstacles on top, so the small shapes stay clickable.
    const rank = { mow: 0, area: 0, nav: 1, obstacle: 2 };
    const order = areas
      .map((a, i) => i)
      .filter((i) => i !== s.areaIndex && !zoneHiddenAt(i))
      .sort((a, b) => (rank[getAreaType(areas[a])] ?? 0) - (rank[getAreaType(areas[b])] ?? 0));
    for (const i of order) {
      const area = areas[i];
      const pts = getEditablePoints(area.outline || []);
      if (pts.length < 2) continue;
      const type = getAreaType(area);
      const isLocked = locked.has(zoneKey(area, i));
      const poly = L.polygon(pts.map(toLatLng), {
        ...zoneStyle(type, false),
        opacity: 0.85,
        interactive: pickable,
        bubblingMouseEvents: false,
      }).addTo(map);
      if (pickable) {
        poly.bindTooltip(
          `${escapeHtml(getZoneName(area, i))} · ${type} · ${formatArea(polygonArea(pts))}${isLocked ? " · 🔒" : ""}`,
          { sticky: true, direction: "top", className: "zone-tooltip", opacity: 0.95 }
        );
        poly.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          if (Date.now() < ignoreClicksUntil) return;
          setAreaIndex(i);
        });
        poly.on("contextmenu", (e) => {
          setAreaIndex(i);
          openZoneMenu(e, i);
        });
      }
      layers.zones.push(poly);
    }
  }

  function render() {
    clearEditLayers();
    renderZones();
    const area = s.mapData?.areas?.[s.areaIndex];
    if (!area) {
      renderDock();
      return;
    }
    const type = getAreaType(area);
    const isLocked = currentIsLocked();

    const pts = currentEditablePoints();
    const latlngs = pts.map(toLatLng);
    renderedPts = pts;
    previewLatLngs = latlngs.slice();

    layers.areaLine = L.polygon(latlngs, {
      ...zoneStyle(type, true),
      opacity: 1,
      dashArray: isLocked ? "2,5" : zoneStyle(type, true).dashArray,
      interactive: ZONE_PICK_TOOLS.includes(tool),
      bubblingMouseEvents: false,
    }).addTo(map);
    if (ZONE_PICK_TOOLS.includes(tool)) {
      layers.areaLine.on("click", (e) => L.DomEvent.stopPropagation(e));
      layers.areaLine.on("contextmenu", (e) => openZoneMenu(e, s.areaIndex));
    }

    if (get(coverageOn) && type === "mow") renderCoverage(pts, area);
    const previewing = get(simplifyPreviewOn);
    renderSimplifyPreview(pts);
    // While previewing a simplify, the dense vertex handles would hide it.
    if (editing && !isLocked && !previewing) {
      renderPoints(pts, latlngs);
      if (tool === "none") renderMidpoints(pts, latlngs);
      renderMultiHandle(pts);
      renderSnapGuide(pts);
    }
    renderDock();
    if (tool === "brush" && brushCursorLatLng) updateBrushCursor(brushCursorLatLng);
  }

  // ---- simplify preview -------------------------------------------------------

  /** Dashed outline + kept vertices of the current zone simplified at the slider tolerance. */
  function renderSimplifyPreview(pts = currentEditablePoints()) {
    if (layers.simplifyPreview) map.removeLayer(layers.simplifyPreview);
    layers.simplifyPreview = null;
    if (!get(simplifyPreviewOn) || pts.length < 3) return;
    const kept = simplify(pts, get(simplifyTolerance)).map(toLatLng);
    const group = L.layerGroup();
    L.polygon(kept, {
      color: "#e879f9",
      weight: 2,
      dashArray: "6,4",
      fillColor: "#e879f9",
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(group);
    kept.forEach((ll) =>
      L.circleMarker(ll, { radius: 3, color: "#fff", weight: 1, fillColor: "#e879f9", fillOpacity: 1, interactive: false }).addTo(group)
    );
    layers.simplifyPreview = group.addTo(map);
  }

  // ---- context menus -------------------------------------------------------

  function openZoneMenu(e, index) {
    const area = s.mapData?.areas?.[index];
    if (!area) return;
    const type = getAreaType(area);
    const isLocked = locked.has(zoneKey(area, index));
    const types = ["mow", "obstacle", "nav"].filter((t) => t !== type);
    openMenu(e, getZoneName(area, index), [
      { label: "Fit to view", icon: "fit_screen", run: () => fitCurrentArea() },
      { label: "Edit details…", icon: "edit", run: () => sidebarTab.set("zones") },
      "divider",
      ...types.map((t) => ({
        label: `Make ${t} zone`,
        icon: t === "mow" ? "grass" : t === "obstacle" ? "block" : "route",
        disabled: isLocked,
        run: () => changeZoneType(t),
      })),
      { label: "Duplicate", icon: "content_copy", run: duplicateZoneAction },
      { label: "Split along a line", icon: "content_cut", disabled: isLocked, run: () => activeTool.set("split") },
      "divider",
      { label: isLocked ? "Unlock" : "Lock", icon: isLocked ? "lock_open" : "lock", run: () => toggleZoneLocked(area, index) },
      { label: "Hide", icon: "visibility_off", run: () => toggleZoneHidden(area, index) },
      { label: "Delete zone", icon: "delete", danger: true, disabled: isLocked, run: removeCurrentZone },
    ]);
  }

  function openVertexMenu(e, idx) {
    selectPoint(idx);
    const pts = currentEditablePoints();
    const p = pts[idx];
    openMenu(e, `Vertex ${idx + 1}${p ? ` · ${p.x.toFixed(2)}, ${p.y.toFixed(2)} m` : ""}`, [
      { label: "Edit coordinates…", icon: "edit_location_alt", run: () => sidebarTab.set("zones") },
      { label: "Make start point", icon: "flag", disabled: idx === 0, run: () => makeStartPoint(idx) },
      { label: "Delete point", icon: "delete", danger: true, disabled: pts.length <= 3, run: removePoint },
    ]);
  }

  function openMapMenu(e) {
    const meters = latLngToMeters(e.latlng, origin());
    const hasMap = Boolean(s.mapData);
    const type = get(drawZoneType);
    openMenu(e, `${meters.x.toFixed(2)}, ${meters.y.toFixed(2)} m`, [
      {
        label: `Draw ${type} polygon from here`,
        icon: "polyline",
        disabled: !hasMap,
        run: () => {
          activeTool.set("poly");
          addPolyPoint(meters);
        },
      },
      {
        label: `Add ${type} square here`,
        icon: "add_box",
        disabled: !hasMap,
        run: () => {
          map.panTo(e.latlng, { animate: false });
          addZoneAtCenter(type);
        },
      },
      {
        label: "Place dock here",
        icon: "ev_station",
        disabled: !hasMap,
        run: () => {
          pushHistory();
          setDock(meters);
          notify("Docking station placed.", "success");
        },
      },
      {
        label: "Measure from here",
        icon: "straighten",
        run: () => {
          activeTool.set("ruler");
          addRulerPoint(meters);
        },
      },
      "divider",
      { label: "Fit whole map", icon: "zoom_out_map", disabled: !hasMap, run: () => fitAll() },
    ]);
  }

  function renderWifiHeatmap(enabled, samples) {
    layers.wifiHeat.forEach((layer) => map.removeLayer(layer));
    layers.wifiHeat = [];
    if (!enabled || !s.origin || !Array.isArray(samples)) return;

    // Scaled off the server's configured grid cell (WIFI_MAP_CELL_SIZE_M) so a
    // coarser/finer setting is actually visible; 3x keeps the default (0.75m)
    // look identical to the old hardcoded 2.2 radius.
    const radius = get(wifiCellSizeM) * 3;

    for (const sample of samples) {
      if (
        !Number.isFinite(sample?.x) ||
        !Number.isFinite(sample?.y) ||
        !Number.isFinite(sample?.signalDbm)
      ) {
        continue;
      }
      layers.wifiHeat.push(
        L.circle(metersToLatLng(sample, origin()), {
          pane: "wifiHeatPane",
          renderer: wifiRenderer,
          radius,
          stroke: false,
          fill: true,
          fillColor: wifiSignalColor(sample.signalDbm),
          fillOpacity: 0.52,
          interactive: false,
        }).addTo(map)
      );
    }
  }

  // Trail points carry an optional `phase` ("docking" covers both docking and
  // undocking, "mowing" covers active mowing) so the line can show what the
  // robot was doing, not just where it went. Colors are fixed regardless of
  // light/dark theme, like the rest of the map's overlays.
  // Picked to stand out against typical aerial imagery (grass/asphalt) and to
  // stay distinct from every other overlay color already in use on this map
  // (nav-zone outlines and the path-preview lines are the same blue as the
  // old "mowing" color, and dark navy reads as near-black over shadowed
  // ground — both were hard to actually see).
  const TRAIL_PHASE_COLORS = {
    docking: "#f97316",
    mowing: "#ec4899",
  };
  const TRAIL_FALLBACK_COLOR = "#facc15";

  function trailPhaseColor(phase) {
    return TRAIL_PHASE_COLORS[phase] || TRAIL_FALLBACK_COLOR;
  }

  /**
   * Mowing draws as a solid, fully-opaque line; anything else (docking,
   * undocking, or an unclassified drive) draws dashed and a bit fainter, so
   * the line itself — not just its color — reads as "this is where it
   * actually cut" vs. "this is just how it got there."
   */
  function trailPhaseStyle(phase, mowingOpacity) {
    const mowing = phase === "mowing";
    return {
      dashArray: mowing ? undefined : "8,8",
      opacity: mowing ? mowingOpacity : Math.max(0.3, mowingOpacity - 0.25),
    };
  }

  /**
   * Split a point list into runs of constant `phase`, duplicating the
   * boundary point into both runs so adjacent, differently-colored polylines
   * still connect visually instead of leaving a gap.
   */
  function splitTrailByPhase(points) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const runs = [];
    let run = [points[0]];
    let runPhase = points[0]?.phase || null;
    for (let i = 1; i < points.length; i += 1) {
      const phase = points[i]?.phase || null;
      if (phase !== runPhase) {
        run.push(points[i]);
        runs.push({ phase: runPhase, points: run });
        run = [points[i]];
        runPhase = phase;
      } else {
        run.push(points[i]);
      }
    }
    if (run.length >= 2) runs.push({ phase: runPhase, points: run });
    return runs;
  }

  /**
   * Draws one polyline per constant-phase run in `points` (see
   * splitTrailByPhase), appending each to `out`. Shared by the live
   * breadcrumb and the persisted trail history — they only differ in line
   * weight/opacity and whether corners are rounded.
   */
  function drawTrailRuns(points, out, { weight, mowingOpacity, lineJoin }) {
    for (const run of splitTrailByPhase(points)) {
      const style = trailPhaseStyle(run.phase, mowingOpacity);
      out.push(
        L.polyline(
          run.points.map((p) => metersToLatLng(p, origin())),
          {
            color: trailPhaseColor(run.phase),
            weight,
            opacity: style.opacity,
            dashArray: style.dashArray,
            lineCap: "round",
            ...(lineJoin ? { lineJoin } : {}),
            interactive: false,
          }
        ).addTo(map)
      );
    }
  }

  /** Breadcrumb of recent live-robot positions — a lightweight "where has it been" trail. */
  function renderRobotTrail(enabled, trail) {
    layers.robotTrail.forEach((layer) => map.removeLayer(layer));
    layers.robotTrail = [];
    if (!enabled || !s.origin || !Array.isArray(trail) || trail.length < 2) return;

    drawTrailRuns(trail, layers.robotTrail, { weight: 3, mowingOpacity: 0.75, lineJoin: "round" });
  }

  // Persisted, mower-side trail history: breaks into separate segments across
  // large time gaps (e.g. the mower was picked up/transported between
  // sessions) instead of drawing a straight teleport line between them.
  const TRAIL_HISTORY_SEGMENT_GAP_MS = 120000;

  function drawTrailHistorySegment(segment, out) {
    drawTrailRuns(segment, out, { weight: 4, mowingOpacity: 0.9 });
  }

  function renderRobotTrailHistory(enabled, points) {
    layers.robotTrailHistory.forEach((layer) => map.removeLayer(layer));
    layers.robotTrailHistory = [];
    if (!enabled || !s.origin || !Array.isArray(points) || points.length < 2) return;

    let segment = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      const gap = (points[i]?.t ?? 0) - (points[i - 1]?.t ?? 0);
      if (gap > TRAIL_HISTORY_SEGMENT_GAP_MS) {
        if (segment.length >= 2) drawTrailHistorySegment(segment, layers.robotTrailHistory);
        segment = [];
      }
      segment.push(points[i]);
    }
    if (segment.length >= 2) drawTrailHistorySegment(segment, layers.robotTrailHistory);
  }

  // Accurate mowing preview: uses the robot's real parameters — global params
  // from /mower_logic (tool_width = spacing) plus per-area map.json overrides,
  // and OpenMower's exact angle logic. Mirrors MowingBehavior.
  function renderCoverage(pts, area) {
    const gp = get(mowParams);
    const spacing = gp.toolWidth;
    if (!(spacing > 0)) return;

    const { laps: lapsRaw, overlap: overlapRaw, outerOffset, angleRad } = resolveMowSettings(
      getZoneOverrides(area),
      gp,
      pts
    );
    const laps = Math.max(0, Math.round(lapsRaw));
    const overlap = Math.max(0, Math.round(overlapRaw));

    const simplified = pts.length > 60 ? simplify(pts, Math.min(0.1, spacing / 3)) : pts;
    if (simplified.length < 3) return;

    // outer_offset shifts the outermost outline (positive = inward for safety).
    let base = simplified;
    if (outerOffset && Math.abs(outerOffset) > 1e-6) {
      const off = offsetPolygon(simplified, outerOffset);
      if (off.length >= 3 && polygonArea(off) > spacing * spacing) base = off;
    }

    const angleDeg = (angleRad * 180) / Math.PI;

    const obstacles = [];
    (s.mapData?.areas || []).forEach((a, i) => {
      if (i === s.areaIndex || getAreaType(a) !== "obstacle") return;
      const op = getEditablePoints(a.outline || []);
      if (op.length < 3) return;
      const c = centroid(op);
      if (c && isPointInsidePolygon(c, base)) obstacles.push(op);
    });

    const perimColor = cssVar("--ok", "#34d399");
    const fillColor = cssVar("--accent-2", "#22d3ee");
    const minArea = spacing * spacing;

    // Perimeter (outline) laps the robot follows first.
    for (let k = 0; k < laps; k += 1) {
      const ring = k === 0 ? base : offsetPolygon(base, k * spacing);
      if (ring.length < 3 || polygonArea(ring) < minArea) break;
      const lls = ring.map((p) => metersToLatLng(p, origin()));
      layers.coverage.push(
        L.polyline([...lls, lls[0]], {
          color: perimColor,
          weight: 1.6,
          opacity: 0.85,
          interactive: false,
        }).addTo(map)
      );
    }

    // Back-and-forth fill, overlapping the innermost `overlap` outline laps.
    const fillInset = Math.max(0, laps - overlap) * spacing;
    const fillBoundary = fillInset > 0 ? offsetPolygon(base, fillInset) : base;
    if (fillBoundary.length >= 3 && polygonArea(fillBoundary) >= minArea) {
      const segs = coverageLines(fillBoundary, obstacles, spacing, angleDeg);
      segs.forEach((seg) => {
        layers.coverage.push(
          L.polyline([metersToLatLng(seg.a, origin()), metersToLatLng(seg.b, origin())], {
            color: fillColor,
            weight: 1,
            opacity: 0.5,
            interactive: false,
          }).addTo(map)
        );
      });
    }
  }

  function renderPoints(pts, latlngs) {
    const colorFirst = cssVar("--pt-first", "#22c55e");
    const colorMid = cssVar("--pt-mid", "#f59e0b");
    const colorSel = cssVar("--pt-sel", "#ef4444");
    const colorMulti = cssVar("--pt-multi", "#22d3ee");
    const colorSnap = cssVar("--pt-snap", "#a855f7");
    const selected = new Set(s.selectedPointIndices);
    const snap = new Set(s.snapPointIndices);
    const draggable = tool === "none";
    // While drawing / placing / measuring, handles must not swallow clicks
    // meant for the map (e.g. a polygon corner placed right on a vertex).
    const interactive = !PLACE_TOOLS.includes(tool);

    latlngs.forEach((latlng, idx) => {
      const isSel = idx === s.pointIndex;
      const color = snap.has(idx)
        ? colorSnap
        : selected.has(idx)
          ? colorMulti
          : isSel
            ? colorSel
            : idx === 0
              ? colorFirst
              : colorMid;
      const size = isSel ? 11 : 9;
      const border = isSel ? 2 : 1;
      const marker = L.marker(latlng, {
        draggable,
        interactive,
        icon: L.divIcon({
          className: "",
          html: `<span class="map-point" style="width:${size}px;height:${size}px;background:${color};border-width:${border}px;"></span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        title: "Drag point directly",
      }).addTo(map);

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (tool === "snap") {
          handleSnapClick(idx);
          return;
        }
        // Shift+click adds / removes a point from the multi-selection.
        if (e.originalEvent?.shiftKey) toggleMultiPoint(idx);
        else selectPoint(idx);
      });
      marker.on("contextmenu", (e) => openVertexMenu(e, idx));

      // Dragging a point that's part of a multi-selection moves the whole
      // selection (e.g. Ctrl+A then drag = move the zone).
      let group = null;
      marker.on("dragstart", () => {
        suppressNextClick = true;
        ignoreClicksUntil = Date.now() + 700;
        pushHistory();
        group =
          selected.has(idx) && selected.size > 1
            ? { indices: [...selected], original: [...selected].map((i) => ({ ...pts[i] })), from: pts[idx] }
            : null;
      });
      // Snap onto neighbouring zones and redraw the outline live while dragging.
      marker.on("drag", (e) => {
        const hit = snapMeters(latLngToMeters(e.latlng, origin()), {
          exclude: s.areaIndex,
          event: e.originalEvent,
        });
        const ll = hit.snapped ? toLatLng(hit.point) : e.latlng;
        if (hit.snapped) {
          marker.setLatLng(ll);
          showSnapIndicator(hit.point, hit.snapped);
        } else hideSnapIndicator();
        if (group) {
          const at = latLngToMeters(L.latLng(ll), origin());
          const dx = at.x - group.from.x;
          const dy = at.y - group.from.y;
          group.indices.forEach((i, k) => {
            const moved = toLatLng({ x: group.original[k].x + dx, y: group.original[k].y + dy });
            previewLatLngs[i] = moved;
            if (i !== idx) layers.points[i]?.setLatLng(moved);
          });
        } else {
          previewLatLngs[idx] = ll;
        }
        layers.areaLine?.setLatLngs(previewLatLngs);
      });
      marker.on("dragend", (e) => {
        ignoreClicksUntil = Date.now() + 700;
        hideSnapIndicator();
        const end = latLngToMeters(e.target.getLatLng(), origin());
        if (group) movePointsBy(group.indices, end.x - group.from.x, end.y - group.from.y, group.original);
        else movePoint(idx, end);
        group = null;
      });
      layers.points.push(marker);
    });
  }

  // Ghost handles on edge midpoints: drag one to insert a vertex there. Only
  // drawn for edges long enough on screen (and in view), which keeps dense
  // traced outlines from turning into a carpet of handles.
  const MIDPOINT_MIN_EDGE_PX = 36;
  const MIDPOINT_MAX = 400;

  function renderMidpoints(pts, latlngs) {
    if (pts.length < 2) return;
    const view = map.getBounds().pad(0.1);
    const n = pts.length;
    for (let i = 0; i < n && layers.midpoints.length < MIDPOINT_MAX; i += 1) {
      const a = latlngs[i];
      const b = latlngs[(i + 1) % n];
      const pa = map.latLngToContainerPoint(a);
      const pb = map.latLngToContainerPoint(b);
      if (pa.distanceTo(pb) < MIDPOINT_MIN_EDGE_PX) continue;
      const mid = L.latLng((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (!view.contains(mid)) continue;
      const insertAt = i + 1;
      const handle = L.marker(mid, {
        draggable: true,
        icon: L.divIcon({
          className: "",
          html: `<span class="map-midpoint"></span>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
        title: "Drag to add a point here",
        zIndexOffset: -100,
      }).addTo(map);
      let base = null;
      handle.on("click", (e) => L.DomEvent.stopPropagation(e));
      handle.on("dragstart", () => {
        suppressNextClick = true;
        ignoreClicksUntil = Date.now() + 700;
        base = previewLatLngs.slice();
        base.splice(insertAt, 0, mid);
      });
      handle.on("drag", (e) => {
        const hit = snapMeters(latLngToMeters(e.latlng, origin()), { exclude: s.areaIndex, event: e.originalEvent });
        const ll = hit.snapped ? toLatLng(hit.point) : e.latlng;
        if (hit.snapped) {
          handle.setLatLng(ll);
          showSnapIndicator(hit.point, hit.snapped);
        } else hideSnapIndicator();
        base[insertAt] = ll;
        layers.areaLine?.setLatLngs(base);
      });
      handle.on("dragend", () => {
        ignoreClicksUntil = Date.now() + 700;
        hideSnapIndicator();
        pushHistory();
        insertPointAtIndex(insertAt, latLngToMeters(handle.getLatLng(), origin()));
      });
      layers.midpoints.push(handle);
    }
  }

  function renderMultiHandle(pts) {
    if (s.selectedPointIndices.length <= 1) return;
    const sel = s.selectedPointIndices;
    const lls = sel.map((i) => metersToLatLng(pts[i], origin()));
    const cLat = lls.reduce((a, b) => a + b[0], 0) / lls.length;
    const cLng = lls.reduce((a, b) => a + b[1], 0) / lls.length;
    const handle = L.marker([cLat, cLng], {
      draggable: true,
      icon: L.divIcon({
        className: "map-marker-leaflet",
        html: `<div class="map-marker--group"><span class="material-symbols-outlined">open_with</span></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      }),
      title: "Drag to move selected points together",
    }).addTo(map);

    let startMeters = null;
    const originalPts = sel.map((i) => ({ x: pts[i].x, y: pts[i].y }));
    handle.on("dragstart", () => {
      suppressNextClick = true;
      ignoreClicksUntil = Date.now() + 700;
      startMeters = latLngToMeters(handle.getLatLng(), origin());
      pushHistory();
    });
    handle.on("dragend", () => {
      ignoreClicksUntil = Date.now() + 700;
      if (!startMeters) return;
      const end = latLngToMeters(handle.getLatLng(), origin());
      movePointsBy(sel, end.x - startMeters.x, end.y - startMeters.y, originalPts);
    });
    layers.multiHandle = handle;
  }

  function renderSnapGuide(pts) {
    const snap = s.snapPointIndices;
    if (!snap.length) return;
    const a = pts[snap[0]];
    const b = snap.length > 1 ? pts[snap[1]] : null;
    const lls = b
      ? [metersToLatLng(a, origin()), metersToLatLng(b, origin())]
      : [metersToLatLng(a, origin())];
    layers.snapGuide = L.polyline(lls, {
      color: "#e11d48",
      weight: 1,
      opacity: 0.9,
      dashArray: "6,6",
    }).addTo(map);
  }

  function renderDock() {
    if (layers.dock) {
      map.removeLayer(layers.dock);
      layers.dock = null;
    }
    const station = s.mapData?.docking_stations?.[0];
    if (!station?.position) return;
    // Heading arrow: map-frame radians (0 = east, CCW) → CSS clockwise degrees
    // for an arrow that points up by default.
    const headingArrow = Number.isFinite(station.heading)
      ? `<span class="dock-heading" style="transform:rotate(${90 - (station.heading * 180) / Math.PI}deg)"><span></span></span>`
      : "";
    const dock = L.marker(metersToLatLng(station.position, origin()), {
      draggable: editing,
      interactive: !PLACE_TOOLS.includes(tool),
      icon: L.divIcon({
        className: "map-marker-leaflet",
        html: `<div class="map-marker--dock">${headingArrow}<span class="material-symbols-outlined">ev_station</span></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
      title: "Dock / charging station (drag to move, right-click for options)",
    }).addTo(map);
    dock.on("click", (e) => L.DomEvent.stopPropagation(e));
    dock.on("contextmenu", (e) => {
      const deg = Number.isFinite(station.heading) ? (station.heading * 180) / Math.PI : 0;
      openMenu(e, "Docking station", [
        { label: "Set from robot pose", icon: "my_location", run: setDockFromRobot },
        { label: "Rotate heading +15°", icon: "rotate_left", run: () => setDockExact({ headingDeg: deg + 15 }) },
        { label: "Rotate heading −15°", icon: "rotate_right", run: () => setDockExact({ headingDeg: deg - 15 }) },
        { label: "Edit position / heading…", icon: "edit", run: () => sidebarTab.set("map") },
        "divider",
        { label: "Remove dock", icon: "delete", danger: true, run: removeDockAction },
      ]);
    });
    dock.on("dragstart", () => {
      ignoreClicksUntil = Date.now() + 700;
      pushHistory();
    });
    dock.on("dragend", (e) => {
      ignoreClicksUntil = Date.now() + 700;
      moveDock(latLngToMeters(e.target.getLatLng(), origin()));
      notify("Dock / charging station moved.", "info");
    });
    layers.dock = dock;
  }

  // ---- snap tool -----------------------------------------------------------

  function handleSnapClick(idx) {
    const snap = s.snapPointIndices;
    if (snap.length === 0) {
      setSnapPoints([idx]);
      setStatus(`Snap start point ${idx + 1} selected. Pick the end point.`);
      return;
    }
    if (snap[0] === idx) {
      setStatus("Pick a different end point.");
      return;
    }
    setSnapPoints([snap[0], idx]);
    pushHistory();
    const changed = snapBetween(snap[0], idx);
    activeTool.set("none");
    notify(`Snapped ${changed} points onto a straight line.`, "success");
  }

  // ---- brush ---------------------------------------------------------------

  function updateBrushCursor(latlng) {
    brushCursorLatLng = latlng;
    if (tool !== "brush") return;
    const r = get(brushRadius);
    const radius = Number.isFinite(r) && r > 0 ? r : 0.35;
    if (layers.brushCursor) {
      layers.brushCursor.setLatLng(latlng).setRadius(radius);
      return;
    }
    layers.brushCursor = L.circle(latlng, {
      radius,
      color: "#38bdf8",
      weight: 1,
      opacity: 0.9,
      fillColor: "#38bdf8",
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(map);
  }

  function removeBrushCursor() {
    if (layers.brushCursor) {
      map.removeLayer(layers.brushCursor);
      layers.brushCursor = null;
    }
  }

  function startBrush(latlng) {
    if (!s.mapData) {
      setStatus("Load a map first.");
      return;
    }
    updateBrushCursor(latlng);
    brushPainting = true;
    brushMoved = 0;
    brushPrev = latLngToMeters(latlng, origin());
    map.dragging.disable();
    pushHistory();
  }

  // Drag-direction smear: move points under the brush along the cursor motion.
  // Pointer moves are queued and applied once per animation frame (one store
  // update + one cheap redraw per frame instead of per mouse event).
  let brushSteps = [];
  let brushFrame = 0;

  function flushBrush() {
    brushFrame = 0;
    if (!brushSteps.length) return;
    const steps = brushSteps;
    brushSteps = [];
    brushMoved += applyBrushSteps(steps, get(brushRadius), get(brushStrength));
  }

  function moveBrush(latlng) {
    updateBrushCursor(latlng);
    if (!brushPainting || !brushPrev) return;
    const cur = latLngToMeters(latlng, origin());
    const delta = { x: cur.x - brushPrev.x, y: cur.y - brushPrev.y };
    if (delta.x !== 0 || delta.y !== 0) {
      brushSteps.push({ center: cur, delta });
      if (!brushFrame) brushFrame = requestAnimationFrame(flushBrush);
    }
    brushPrev = cur;
  }

  /**
   * Mid-stroke redraw: the brush only moves existing vertices, so patch the
   * selected outline and the moved handles in place instead of rebuilding
   * every layer. Returns false when a full render is needed instead.
   */
  function brushFastRedraw() {
    const area = s.mapData?.areas?.[s.areaIndex];
    if (!area || !layers.areaLine) return false;
    const pts = currentEditablePoints();
    if (pts.length !== renderedPts.length) return false;
    const hasHandles = layers.points.length === pts.length;
    const latlngs = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 1) {
      latlngs[i] = toLatLng(pts[i]);
      const old = renderedPts[i];
      if (hasHandles && (old.x !== pts[i].x || old.y !== pts[i].y)) layers.points[i].setLatLng(latlngs[i]);
    }
    renderedPts = pts;
    previewLatLngs = latlngs.slice();
    layers.areaLine.setLatLngs(latlngs);
    return true;
  }

  function endBrush() {
    if (!brushPainting) return;
    if (brushFrame) cancelAnimationFrame(brushFrame);
    flushBrush();
    brushPainting = false;
    render(); // full redraw (coverage, other zones, …) once the stroke ends
    brushPrev = null;
    map.dragging.enable();
    suppressNextClick = true;
    ignoreClicksUntil = Date.now() + 200;
    setStatus(
      brushMoved > 0
        ? `Brush moved ${brushMoved} point updates.`
        : "Drag across points to push them in that direction."
    );
  }

  // ---- rectangle / circle draw ---------------------------------------------

  function startDraw(latlng) {
    if (!s.mapData) {
      setStatus("Load a map first.");
      return;
    }
    drawActive = true;
    drawStart = latlng;
    map.dragging.disable();
    if (layers.drawPreview) map.removeLayer(layers.drawPreview);
    const style = { color: "#22d3ee", weight: 1.5, fillColor: "#22d3ee", fillOpacity: 0.12, dashArray: "5,5" };
    layers.drawPreview =
      tool === "rect"
        ? L.rectangle(L.latLngBounds(latlng, latlng), style).addTo(map)
        : L.circle(latlng, { ...style, radius: 0 }).addTo(map);
  }

  function updateDraw(latlng) {
    if (!drawActive || !layers.drawPreview) return;
    if (tool === "rect") {
      layers.drawPreview.setBounds(L.latLngBounds(drawStart, latlng));
    } else {
      const r = distance(latLngToMeters(drawStart, origin()), latLngToMeters(latlng, origin()));
      layers.drawPreview.setRadius(r);
    }
  }

  function finishDraw(latlng) {
    if (!drawActive) return;
    const kind = tool;
    drawActive = false;
    map.dragging.enable();
    if (layers.drawPreview) {
      map.removeLayer(layers.drawPreview);
      layers.drawPreview = null;
    }
    suppressNextClick = true;
    ignoreClicksUntil = Date.now() + 250;

    const type = get(drawZoneType);
    if (kind === "rect") {
      const a = latLngToMeters(drawStart, origin());
      const b = latLngToMeters(latlng, origin());
      if (Math.abs(a.x - b.x) < 0.1 || Math.abs(a.y - b.y) < 0.1) {
        setStatus("Rectangle too small — drag a larger area.");
        return;
      }
      pushHistory();
      addZoneFromPoints(type, rectangleOutline(a, b));
    } else {
      const center = latLngToMeters(drawStart, origin());
      const r = distance(center, latLngToMeters(latlng, origin()));
      if (r < 0.1) {
        setStatus("Circle too small — drag a larger radius.");
        return;
      }
      const segments = Math.max(12, Math.min(64, Math.round(r * 6)));
      pushHistory();
      addZoneFromPoints(type, circleOutline(center, r, segments));
    }
    activeTool.set("none");
    fitCurrentArea();
    notify(`Drew ${type} ${kind === "rect" ? "rectangle" : "circle"}.`, "success");
  }

  function cancelDraw() {
    drawActive = false;
    drawStart = null;
    if (layers.drawPreview) {
      map.removeLayer(layers.drawPreview);
      layers.drawPreview = null;
    }
    map.dragging.enable();
  }

  // ---- polygon draw (click vertices, finish on first point / dbl-click / Enter)

  const DRAFT_STYLE = { color: "#22d3ee", weight: 2, opacity: 0.95, interactive: false };

  function renderPolyDraft() {
    if (layers.poly) map.removeLayer(layers.poly);
    layers.poly = null;
    polyDraftCount.set(polyPts.length);
    if (!polyPts.length) return;
    const group = L.layerGroup();
    const lls = polyPts.map(toLatLng);
    if (lls.length >= 3) {
      L.polygon(lls, { ...DRAFT_STYLE, weight: 0, fillColor: "#22d3ee", fillOpacity: 0.12 }).addTo(group);
    }
    L.polyline(lls, DRAFT_STYLE).addTo(group);
    if (hoverMeters) {
      const h = toLatLng(hoverMeters);
      L.polyline([lls[lls.length - 1], h], { ...DRAFT_STYLE, dashArray: "5,5" }).addTo(group);
      if (lls.length >= 2) L.polyline([h, lls[0]], { ...DRAFT_STYLE, weight: 1, dashArray: "2,6" }).addTo(group);
    }
    lls.forEach((ll, i) => {
      L.circleMarker(ll, {
        radius: i === 0 ? 7 : 4,
        color: "#fff",
        weight: 1.5,
        fillColor: i === 0 ? "#22c55e" : "#22d3ee",
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
    });
    layers.poly = group.addTo(map);
  }

  /** Is `meters` on top of the draft's first vertex (→ close the polygon)? */
  function nearPolyStart(meters) {
    if (polyPts.length < 3) return false;
    return distance(meters, polyPts[0]) <= SNAP_TOLERANCE_PX * metersPerPixel();
  }

  function addPolyPoint(meters) {
    if (!s.mapData) {
      setStatus("Load a map first.");
      return;
    }
    const last = polyPts[polyPts.length - 1];
    if (last && distance(last, meters) < 0.01) return; // double-click repeat
    polyPts = [...polyPts, { x: meters.x, y: meters.y }];
    renderPolyDraft();
  }

  function undoPolyPoint() {
    if (!polyPts.length) return false;
    polyPts = polyPts.slice(0, -1);
    renderPolyDraft();
    return true;
  }

  function cancelPoly() {
    polyPts = [];
    hoverMeters = null;
    renderPolyDraft();
  }

  function finishPoly() {
    if (polyPts.length < 3) {
      setStatus("A zone needs at least 3 points.");
      return false;
    }
    const pts = polyPts;
    const type = get(drawZoneType);
    polyPts = [];
    hoverMeters = null;
    renderPolyDraft();
    pushHistory();
    addZoneFromPoints(type, pts);
    activeTool.set("none");
    notify(`Drew ${type} zone with ${pts.length} points.`, "success");
    return true;
  }

  // ---- ruler -----------------------------------------------------------------

  function updateRulerInfo() {
    let total = 0;
    for (let i = 1; i < rulerPts.length; i += 1) total += distance(rulerPts[i - 1], rulerPts[i]);
    const last = rulerPts.length && hoverMeters ? distance(rulerPts[rulerPts.length - 1], hoverMeters) : 0;
    rulerInfo.set({ points: rulerPts.length, total, last });
  }

  function renderRuler() {
    if (layers.ruler) map.removeLayer(layers.ruler);
    layers.ruler = null;
    updateRulerInfo();
    if (!rulerPts.length) return;
    const group = L.layerGroup();
    const style = { color: "#facc15", weight: 2.5, opacity: 1, interactive: false };
    const lls = rulerPts.map(toLatLng);
    L.polyline(lls, style).addTo(group);
    if (hoverMeters) {
      L.polyline([lls[lls.length - 1], toLatLng(hoverMeters)], { ...style, dashArray: "5,5" }).addTo(group);
    }
    let total = 0;
    for (let i = 1; i < rulerPts.length; i += 1) {
      const d = distance(rulerPts[i - 1], rulerPts[i]);
      total += d;
      const mid = toLatLng({ x: (rulerPts[i - 1].x + rulerPts[i].x) / 2, y: (rulerPts[i - 1].y + rulerPts[i].y) / 2 });
      L.tooltip({ permanent: true, direction: "center", className: "ruler-label", interactive: false })
        .setLatLng(mid)
        .setContent(formatLength(d))
        .addTo(group);
    }
    lls.forEach((ll) =>
      L.circleMarker(ll, { radius: 4, color: "#000", weight: 1, fillColor: "#facc15", fillOpacity: 1, interactive: false }).addTo(group)
    );
    if (rulerPts.length > 2) {
      L.tooltip({ permanent: true, direction: "right", offset: [10, 0], className: "ruler-label ruler-label--total", interactive: false })
        .setLatLng(lls[lls.length - 1])
        .setContent(`Σ ${formatLength(total)}`)
        .addTo(group);
    }
    layers.ruler = group.addTo(map);
  }

  function addRulerPoint(meters) {
    rulerPts = [...rulerPts, { x: meters.x, y: meters.y }];
    renderRuler();
  }

  function clearRuler() {
    rulerPts = [];
    hoverMeters = null;
    renderRuler();
  }

  // ---- split (click two points to cut the selected zone along a line) -------

  function renderSplit() {
    if (layers.split) map.removeLayer(layers.split);
    layers.split = null;
    if (!splitStart) return;
    const end = hoverMeters || splitStart;
    // Extend the preview past both clicks so it reads as an infinite cut line
    // — but only just across the zone: Leaflet draws each segment straight in
    // Web Mercator, so a km-long guide would visibly bow off the true (local
    // metric) line the split actually uses.
    const dx = end.x - splitStart.x;
    const dy = end.y - splitStart.y;
    const len = Math.hypot(dx, dy) || 1;
    const box = boundingBox(currentEditablePoints());
    const reach = box
      ? Math.max(
          ...[
            { x: box.minX, y: box.minY },
            { x: box.maxX, y: box.maxY },
            { x: box.minX, y: box.maxY },
            { x: box.maxX, y: box.minY },
          ].map((c) => distance(c, splitStart))
        ) + 5
      : 20;
    const a = { x: splitStart.x - (dx / len) * reach, y: splitStart.y - (dy / len) * reach };
    const b = { x: splitStart.x + (dx / len) * reach, y: splitStart.y + (dy / len) * reach };
    const group = L.layerGroup();
    if (hoverMeters) L.polyline([toLatLng(a), toLatLng(b)], { color: "#f43f5e", weight: 1, dashArray: "6,6", interactive: false }).addTo(group);
    L.polyline([toLatLng(splitStart), toLatLng(end)], { color: "#f43f5e", weight: 2.5, interactive: false }).addTo(group);
    L.circleMarker(toLatLng(splitStart), { radius: 5, color: "#fff", weight: 1.5, fillColor: "#f43f5e", fillOpacity: 1, interactive: false }).addTo(group);
    layers.split = group.addTo(map);
  }

  function handleSplitClick(meters) {
    if (!splitStart) {
      if (!s.mapData?.areas?.[s.areaIndex]) {
        setStatus("Select a zone to split first.");
        return;
      }
      splitStart = meters;
      renderSplit();
      setStatus("Now click the second point of the cut line.");
      return;
    }
    const p1 = splitStart;
    splitStart = null;
    hoverMeters = null;
    renderSplit();
    if (splitCurrentZone(p1, meters)) activeTool.set("none");
  }

  // ---- recording / trail-to-zone previews --------------------------------------

  function renderRecording(r) {
    if (layers.recording) map.removeLayer(layers.recording);
    layers.recording = null;
    if (!r?.active || !r.points.length) return;
    const group = L.layerGroup();
    const lls = r.points.map(toLatLng);
    L.polyline(lls, { color: "#fb923c", weight: 3, opacity: 0.95, interactive: false }).addTo(group);
    if (lls.length > 2) L.polyline([lls[lls.length - 1], lls[0]], { color: "#fb923c", weight: 1.5, dashArray: "4,6", interactive: false }).addTo(group);
    L.circleMarker(lls[0], { radius: 6, color: "#fff", weight: 2, fillColor: "#fb923c", fillOpacity: 1, interactive: false }).addTo(group);
    layers.recording = group.addTo(map);
  }

  function renderTrailZone(path, outline) {
    if (layers.trailZone) map.removeLayer(layers.trailZone);
    layers.trailZone = null;
    if (!path?.length) return;
    const group = L.layerGroup();
    L.polyline(path.map(toLatLng), { color: "#facc15", weight: 2, opacity: 0.7, interactive: false }).addTo(group);
    if (outline) {
      L.polygon(outline.map(toLatLng), { color: "#22d3ee", weight: 2, dashArray: "5,4", fillColor: "#22d3ee", fillOpacity: 0.15, interactive: false }).addTo(group);
    }
    layers.trailZone = group.addTo(map);
  }

  // ---- box select ----------------------------------------------------------

  // Shift+drag in the select tool draws a selection box. Listened on the
  // container in the capture phase so it also starts on top of a zone shape
  // (which stops Leaflet event bubbling) and before map panning kicks in.
  // A Shift+click on a point handle is left alone (that toggles the point).
  const BOX_START_PX = 4;
  let boxDown = null; // {x, y} client px of a pending Shift+mousedown

  function onBoxDown(e) {
    if (tool !== "none" || !e.shiftKey || e.button !== 0 || !s.mapData?.areas?.[s.areaIndex]) return;
    if (e.target.closest?.(".leaflet-marker-icon")) return;
    boxDown = { x: e.clientX, y: e.clientY };
    map.dragging.disable();
    document.addEventListener("mousemove", onBoxMove);
    document.addEventListener("mouseup", onBoxUp);
  }

  function onBoxMove(e) {
    if (!boxDown) return;
    if (!boxActive && Math.hypot(e.clientX - boxDown.x, e.clientY - boxDown.y) < BOX_START_PX) return;
    const end = map.mouseEventToLatLng(e);
    if (!boxActive) {
      boxActive = true;
      boxStart = map.mouseEventToLatLng({ clientX: boxDown.x, clientY: boxDown.y });
      layers.boxSelect = L.rectangle(L.latLngBounds(boxStart, end), {
        color: "#22d3ee",
        weight: 1,
        fillOpacity: 0.12,
        dashArray: "4,4",
        interactive: false,
      }).addTo(map);
    }
    layers.boxSelect.setBounds(L.latLngBounds(boxStart, end));
  }

  function cancelBox() {
    document.removeEventListener("mousemove", onBoxMove);
    document.removeEventListener("mouseup", onBoxUp);
    if (layers.boxSelect) map.removeLayer(layers.boxSelect);
    layers.boxSelect = null;
    boxActive = false;
    boxStart = null;
    boxDown = null;
    map.dragging.enable();
  }

  function onBoxUp(e) {
    if (!boxActive) {
      cancelBox();
      return;
    }
    const bounds = L.latLngBounds(boxStart, map.mouseEventToLatLng(e));
    cancelBox();
    suppressNextClick = true;
    ignoreClicksUntil = Date.now() + 250;
    const picked = [];
    currentEditablePoints().forEach((p, i) => {
      if (bounds.contains(toLatLng(p))) picked.push(i);
    });
    // Shift+drag again adds to the existing selection.
    const merged = [...new Set([...s.selectedPointIndices, ...(s.pointIndex != null ? [s.pointIndex] : []), ...picked])];
    setMultiSelection(merged.sort((a, b) => a - b));
    setStatus(`Selected ${merged.length} point(s) — drag one to move them all, Del removes them.`);
  }

  map.getContainer().addEventListener("mousedown", onBoxDown, true);

  // ---- map-level handlers --------------------------------------------------

  map.on("click", (e) => {
    if (Date.now() < ignoreClicksUntil) return;
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const raw = latLngToMeters(e.latlng, origin());
    if (tool === "poly") {
      if (nearPolyStart(raw)) {
        finishPoly();
        return;
      }
      addPolyPoint(snapMeters(raw, { event: e.originalEvent }).point);
      return;
    }
    if (tool === "ruler") {
      addRulerPoint(snapMeters(raw, { event: e.originalEvent }).point);
      return;
    }
    if (tool === "split") {
      handleSplitClick(raw);
      return;
    }
    const meters = tool === "dock" || tool === "add" ? snapMeters(raw, { exclude: s.areaIndex, event: e.originalEvent }).point : raw;
    if (tool === "dock") {
      if (!s.mapData) {
        setStatus("Load a map first.");
        return;
      }
      pushHistory();
      setDock(meters);
      activeTool.set("none");
      notify("Docking station placed.", "success");
      return;
    }
    if (tool === "add") {
      if (!s.mapData?.areas?.[s.areaIndex] || !guardEditable()) return;
      pushHistory();
      const idx = nearestEdgeInsertIndex(currentEditablePoints(), meters);
      insertPointAtIndex(idx, meters);
      return;
    }
    // Select tool: a click on empty map drops the point selection.
    if (tool === "none" && (s.pointIndex != null || s.selectedPointIndices.length)) clearSelection();
  });

  map.on("dblclick", (e) => {
    if (tool === "poly") {
      L.DomEvent.stopPropagation(e);
      finishPoly();
    }
  });

  map.on("contextmenu", (e) => {
    if (tool === "poly" && polyPts.length) {
      // Right-click while drawing finishes the polygon, like most GIS tools.
      if (e.originalEvent?.preventDefault) e.originalEvent.preventDefault();
      finishPoly();
      return;
    }
    if (tool === "ruler" && rulerPts.length) {
      if (e.originalEvent?.preventDefault) e.originalEvent.preventDefault();
      clearRuler();
      return;
    }
    openMapMenu(e);
  });

  map.on("mousedown", (e) => {
    if (tool === "brush") {
      if (e.originalEvent?.button != null && e.originalEvent.button !== 0) return;
      if (currentIsLocked()) {
        guardEditable();
        return;
      }
      startBrush(e.latlng);
      return;
    }
    if (tool === "rect" || tool === "circle") {
      if (e.originalEvent?.button != null && e.originalEvent.button !== 0) return;
      startDraw(e.latlng);
      return;
    }
  });

  map.on("mousemove", (e) => {
    if (tool === "brush") {
      moveBrush(e.latlng);
      return;
    }
    if (tool === "poly" || tool === "ruler" || tool === "split") {
      const raw = latLngToMeters(e.latlng, origin());
      const hit = tool === "split" ? { point: raw, snapped: null } : snapMeters(raw, { event: e.originalEvent });
      hoverMeters = hit.point;
      if (hit.snapped) showSnapIndicator(hit.point, hit.snapped);
      else hideSnapIndicator();
      if (tool === "poly" && polyPts.length) renderPolyDraft();
      if (tool === "ruler" && rulerPts.length) renderRuler();
      if (tool === "split" && splitStart) renderSplit();
      return;
    }
    if (drawActive) updateDraw(e.latlng);
  });

  map.on("mouseup", (e) => {
    if (tool === "brush" && brushPainting) {
      endBrush();
      return;
    }
    if (drawActive) finishDraw(e.latlng);
  });

  map.on("mouseout", () => {
    if (tool === "brush" && brushPainting) endBrush();
  });
  map.on("touchstart", (e) => tool === "brush" && startBrush(e.latlng));
  map.on("touchmove", (e) => tool === "brush" && moveBrush(e.latlng));
  map.on("touchend", () => tool === "brush" && brushPainting && endBrush());

  // ---- robot marker (separate subscription, avoids full re-render) ---------
  //
  // The server streams discrete pose samples (~20 Hz). We tween the marker
  // toward the latest sample every animation frame so it glides smoothly:
  // position + heading update per frame (cheap), while the icon HTML (visual
  // mode + HUD) is only rebuilt when its content actually changes.

  const ROBOT_LERP = 0.25; // fraction toward target per frame (~150 ms settle)
  const ROBOT_SNAP_DIST2 = 9; // >3 m jump → teleport instead of gliding across
  const ROBOT_SETTLE_D2 = 1e-4; // ~1 cm: close enough to snap and stop the loop
  const ROBOT_SETTLE_YAW = 0.005; // ~0.3°
  const robotAnim = { cur: null, target: null, raf: 0, iconKey: "", rotate: false, glyphEl: null };

  function stopRobotAnim() {
    if (robotAnim.raf) {
      cancelAnimationFrame(robotAnim.raf);
      robotAnim.raf = 0;
    }
  }

  // Rotate just the cached glyph element (re-queried only when the icon rebuilds).
  function applyRobotTransform() {
    const el = robotAnim.glyphEl;
    if (!el || !robotAnim.cur) return;
    el.style.transform = robotAnim.rotate
      ? `rotate(${90 - (robotAnim.cur.yaw * 180) / Math.PI}deg)`
      : "none";
  }

  function moveRobotTo(pt) {
    layers.robot.setLatLng(metersToLatLng(pt, origin()));
    applyRobotTransform();
  }

  function stepRobot() {
    if (!layers.robot || !robotAnim.cur || !robotAnim.target) {
      robotAnim.raf = 0;
      return;
    }
    const t = robotAnim.target;
    let dyaw = (t.yaw - robotAnim.cur.yaw) % (2 * Math.PI);
    if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    else if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    // Settled: snap exactly, apply once, and idle the loop (renderRobot restarts
    // it on the next sample). Avoids 60 fps DOM writes for a parked robot.
    if (poseDist2(robotAnim.cur, t) < ROBOT_SETTLE_D2 && Math.abs(dyaw) < ROBOT_SETTLE_YAW) {
      robotAnim.cur = { ...t };
      moveRobotTo(robotAnim.cur);
      robotAnim.raf = 0;
      return;
    }
    robotAnim.cur = stepPose(robotAnim.cur, t, ROBOT_LERP);
    moveRobotTo(robotAnim.cur);
    robotAnim.raf = requestAnimationFrame(stepRobot);
  }

  function renderRobot(live, pose) {
    if (!live || !pose || !pose.ok) {
      stopRobotAnim();
      if (layers.robot) {
        map.removeLayer(layers.robot);
        layers.robot = null;
      }
      robotAnim.cur = null;
      robotAnim.target = null;
      robotAnim.iconKey = "";
      robotAnim.glyphEl = null;
      return;
    }

    const target = { x: pose.x, y: pose.y, yaw: pose.yaw };
    robotAnim.target = target;
    if (get(followRobot)) keepInView(target);
    const visual = resolveRobotVisualMode(pose.ros);
    robotAnim.rotate = visual === "nav";

    // First fix, or a large jump (relocalization) → snap rather than glide.
    if (!robotAnim.cur || !layers.robot || poseDist2(robotAnim.cur, target) > ROBOT_SNAP_DIST2) {
      robotAnim.cur = { ...target };
    }

    // Cheap change key from visual + HUD text; only rebuild the icon when it moves.
    const lines = buildRobotHudLines(pose.ros?.telemetry || null);
    const key = `${visual}|${lines.join("")}`;
    if (!layers.robot) {
      layers.robot = L.marker(metersToLatLng(robotAnim.cur, origin()), {
        icon: makeRobotIcon(visual, lines),
        zIndexOffset: 800,
      })
        .bindTooltip(buildRobotPoseTooltip(pose), {
          sticky: true,
          direction: "top",
          opacity: 0.95,
          className: "robot-tooltip",
        })
        .addTo(map);
      robotAnim.iconKey = key;
      robotAnim.glyphEl = layers.robot._icon?.querySelector(".robot-glyph") || null;
    } else {
      if (key !== robotAnim.iconKey) {
        layers.robot.setIcon(makeRobotIcon(visual, lines));
        robotAnim.iconKey = key;
        robotAnim.glyphEl = layers.robot._icon?.querySelector(".robot-glyph") || null;
      }
      // Only refresh the tooltip text while it's actually open.
      if (layers.robot.isTooltipOpen()) {
        layers.robot.setTooltipContent(buildRobotPoseTooltip(pose));
      }
    }
    applyRobotTransform(); // avoid a one-frame flash after an icon rebuild
    if (!robotAnim.raf) robotAnim.raf = requestAnimationFrame(stepRobot);
  }

  function makeRobotIcon(visual, lines) {
    const { modifier, glyph } = robotVisualToMarkerStyle(visual);
    // Rotation is applied per-frame via applyRobotTransform(), not baked here.
    const inner = robotGlyphInner(visual, glyph);
    const hud = lines.length
      ? lines.map((l) => `<div class="robot-marker-hud__line">${escapeHtml(l)}</div>`).join("")
      : "";
    if (!hud) {
      return L.divIcon({
        className: "map-marker-leaflet",
        html: `<div class="map-marker--robot ${modifier}">${inner}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
    }
    const stackW = 200;
    const stackH = 40 + 4 + 6 + lines.length * 15;
    return L.divIcon({
      className: "map-marker-leaflet robot-marker-stack-wrap",
      html: `<div class="robot-marker-stack" style="width:${stackW}px"><div class="robot-marker-stack__pin"><div class="map-marker--robot ${modifier}">${inner}</div></div><div class="robot-marker-stack__hud">${hud}</div></div>`,
      iconSize: [stackW, stackH],
      iconAnchor: [stackW / 2, 20],
    });
  }

  // ---- exact path (real slic3r planner overlay) ----------------------------

  function renderExactPath(data) {
    if (layers.exactPath) {
      map.removeLayer(layers.exactPath);
      layers.exactPath = null;
    }
    if (!data || !Array.isArray(data.paths) || !data.paths.length) return;
    const outlineColor = cssVar("--ok", "#34d399");
    const fillColor = cssVar("--accent-2", "#22d3ee");
    const group = L.layerGroup();
    for (const seg of data.paths) {
      if (!seg.pts || seg.pts.length < 2) continue;
      L.polyline(
        seg.pts.map((p) => metersToLatLng(p, origin())),
        {
          color: seg.isOutline ? outlineColor : fillColor,
          weight: 2,
          opacity: 0.9,
          interactive: false,
        }
      ).addTo(group);
    }
    const first = data.paths[0]?.pts?.[0];
    if (first) {
      L.circleMarker(metersToLatLng(first, origin()), {
        radius: 4,
        color: outlineColor,
        fillColor: outlineColor,
        fillOpacity: 1,
        weight: 1,
        interactive: false,
      }).addTo(group);
    }
    group.addTo(map);
    layers.exactPath = group;
  }

  // ---- follow robot -----------------------------------------------------------

  /** Pan so `pt` stays in the middle half of the view (no jitter while it's well inside). */
  function keepInView(pt) {
    const ll = toLatLng(pt);
    if (!map.getBounds().pad(-0.25).contains(ll)) map.panTo(ll, { animate: true, duration: 0.4 });
  }

  /** Center on the live robot. Returns false when there's no live position yet. */
  function locateRobot() {
    const pose = get(robotPose);
    if (!get(robotLive) || !pose?.ok) return false;
    map.setView(toLatLng(pose), Math.max(map.getZoom(), 20));
    return true;
  }

  // Panning by hand means "let me look elsewhere" — stop following.
  map.on("dragstart", () => followRobot.set(false));

  // ---- public helpers ------------------------------------------------------

  function getCenterMeters() {
    return latLngToMeters(map.getCenter(), origin());
  }

  function fitCurrentArea() {
    const pts = currentEditablePoints();
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map((p) => metersToLatLng(p, origin())));
    // Zoom in close on the zone; past the imagery's native zoom the tile
    // layer upscales (maxNativeZoom) instead of showing blank tiles.
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.06), { maxZoom: 22 });
  }

  /** Fit every zone plus the dock. */
  function fitAll() {
    const pts = [];
    for (const a of s.mapData?.areas || []) pts.push(...getEditablePoints(a.outline || []));
    const dock = s.mapData?.docking_stations?.[0]?.position;
    if (dock) pts.push(dock);
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map(toLatLng));
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.1), { maxZoom: 20 });
  }

  /**
   * Keys for the multi-click tools (Enter / Backspace). Returns true when the
   * key was consumed so the global shortcut handler skips its default.
   */
  function handleKey(key) {
    if (tool === "poly") {
      if (key === "enter") return finishPoly() || true;
      if (key === "backspace" || key === "delete") return undoPolyPoint() || true;
    }
    if (tool === "ruler" && (key === "backspace" || key === "delete")) {
      if (rulerPts.length) {
        rulerPts = rulerPts.slice(0, -1);
        renderRuler();
      }
      return true;
    }
    return false;
  }

  function panToPoint(meters, zoom) {
    map.setView(metersToLatLng(meters, origin()), zoom || Math.max(map.getZoom(), 20));
  }

  // ---- store wiring --------------------------------------------------------

  const unsubs = [];
  let prevOriginKey = "";
  unsubs.push(activeBasemap.subscribe((cfg) => applyBasemap(cfg)));
  unsubs.push(
    editor.subscribe((value) => {
      s = value;
      if (!(brushPainting && brushFastRedraw())) render();
      // These overlays use absolute map metres, so they only need a redraw
      // when the projection origin moves — not on every vertex edit.
      const key = `${value.origin?.lat},${value.origin?.lng}`;
      if (key !== prevOriginKey) {
        prevOriginKey = key;
        renderExactPath(get(exactPath));
        renderWifiHeatmap(get(wifiOverlayEnabled), get(wifiSamples));
        renderRobotTrail(get(robotTrailEnabled), get(robotTrail));
        renderRobotTrailHistory(get(robotTrailHistoryEnabled), get(robotTrailDisplayPoints));
      }
    })
  );
  unsubs.push(
    activeTool.subscribe((value) => {
      const prev = tool;
      tool = value;
      // Switching tools clears any point/multi/snap selection from the old tool.
      if (prev !== value) clearSelection();
      if (prev === "brush" && value !== "brush") {
        removeBrushCursor();
        map.dragging.enable();
      }
      if (value === "brush" && brushCursorLatLng) {
        updateBrushCursor(brushCursorLatLng);
      }
      if ((prev === "rect" || prev === "circle") && value !== prev) {
        cancelDraw();
      }
      if (prev === "poly" && value !== "poly") cancelPoly();
      if (prev === "ruler" && value !== "ruler") clearRuler();
      if (prev === "split" && value !== "split") {
        splitStart = null;
        renderSplit();
      }
      if (prev !== value) {
        hoverMeters = null;
        hideSnapIndicator();
      }
      // Double-click finishes a polygon instead of zooming.
      if (value === "poly") map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
      if (prev === "none" && value !== "none" && (boxDown || boxActive)) cancelBox();
      // Crosshair cursor for click/drag-to-place tools.
      const crosshair = ["add", "brush", "snap", "rect", "circle", "dock", "poly", "ruler", "split"].includes(value);
      map.getContainer().style.cursor = crosshair ? "crosshair" : "";
      render();
    })
  );
  unsubs.push(
    robotPose.subscribe((pose) => renderRobot(get(robotLive), pose))
  );
  unsubs.push(robotLive.subscribe((live) => renderRobot(live, get(robotPose))));
  unsubs.push(
    wifiSamples.subscribe((samples) => renderWifiHeatmap(get(wifiOverlayEnabled), samples))
  );
  unsubs.push(
    wifiCellSizeM.subscribe(() => renderWifiHeatmap(get(wifiOverlayEnabled), get(wifiSamples)))
  );
  unsubs.push(
    wifiOverlayEnabled.subscribe((enabled) => renderWifiHeatmap(enabled, get(wifiSamples)))
  );
  unsubs.push(
    robotTrail.subscribe((trail) => renderRobotTrail(get(robotTrailEnabled), trail))
  );
  unsubs.push(
    robotTrailEnabled.subscribe((enabled) => renderRobotTrail(enabled, get(robotTrail)))
  );
  unsubs.push(
    robotTrailDisplayPoints.subscribe((points) =>
      renderRobotTrailHistory(get(robotTrailHistoryEnabled), points)
    )
  );
  unsubs.push(
    robotTrailHistoryEnabled.subscribe((enabled) =>
      renderRobotTrailHistory(enabled, get(robotTrailDisplayPoints))
    )
  );
  unsubs.push(coverageOn.subscribe(() => render()));
  unsubs.push(
    hiddenZones.subscribe((v) => {
      hidden = v;
      render();
    })
  );
  unsubs.push(
    lockedZones.subscribe((v) => {
      locked = v;
      render();
    })
  );
  unsubs.push(snapEnabled.subscribe((v) => (snapOn = v)));
  unsubs.push(
    editMode.subscribe((v) => {
      const was = editing;
      editing = v;
      if (was && !v) {
        activeTool.set("none");
        clearSelection();
      }
      render();
    })
  );
  unsubs.push(followRobot.subscribe((on) => on && locateRobot()));
  // Toggling the preview changes which handles are drawn (full re-render);
  // moving the slider only redraws the preview layer.
  unsubs.push(simplifyPreviewOn.subscribe(() => render()));
  unsubs.push(simplifyTolerance.subscribe(() => renderSimplifyPreview()));
  unsubs.push(recording.subscribe((r) => renderRecording(r)));
  unsubs.push(trailZonePath.subscribe((path) => renderTrailZone(path, get(trailZoneOutline))));
  unsubs.push(trailZoneOutline.subscribe((outline) => renderTrailZone(get(trailZonePath), outline)));
  // Midpoint handles depend on on-screen edge length and the view, so rebuild
  // just them (not the whole edit layer) after panning / zooming.
  function refreshMidpoints() {
    layers.midpoints.forEach((m) => map.removeLayer(m));
    layers.midpoints = [];
    if (!editing || tool !== "none" || !s.mapData?.areas?.[s.areaIndex] || currentIsLocked()) return;
    const pts = currentEditablePoints();
    renderMidpoints(pts, pts.map(toLatLng));
  }
  map.on("moveend", refreshMidpoints);

  const onKeyDown = (e) => {
    if (e.key === "Alt") altHeld = true;
  };
  const onKeyUp = (e) => {
    if (e.key === "Alt") altHeld = false;
  };
  const onBlur = () => (altHeld = false);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  unsubs.push(mowParams.subscribe(() => render()));
  unsubs.push(exactPath.subscribe((d) => renderExactPath(d)));

  // Keep Leaflet sized correctly once laid out.
  setTimeout(() => map.invalidateSize(), 60);

  return {
    map,
    getCenterMeters,
    fitCurrentArea,
    fitAll,
    panToPoint,
    locateRobot,
    handleKey,
    finishPolygon: finishPoly,
    undoPolygonPoint: undoPolyPoint,
    addPolyPoint,
    clearRuler,
    zoomIn: () => map.zoomIn(),
    zoomOut: () => map.zoomOut(),
    invalidateSize: () => map.invalidateSize(),
    destroy() {
      stopRobotAnim();
      unsubs.forEach((u) => u());
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      map.remove();
    },
  };
}
