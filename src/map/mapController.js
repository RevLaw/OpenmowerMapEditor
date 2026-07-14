import L from "leaflet";
import { get } from "svelte/store";
import { metersToLatLng, latLngToMeters } from "../lib/geo/projection.js";
import { getAreaType } from "../lib/format/mapFormat.js";
import {
  nearestEdgeInsertIndex,
  distance,
  centroid,
  isPointInsidePolygon,
  offsetPolygon,
  polygonArea,
  simplify,
  principalAngleDeg,
} from "../lib/geo/geometry.js";
import { coverageLines } from "../lib/geo/coverage.js";
import { rectangleOutline, circleOutline } from "../lib/format/shapes.js";
import { getEditablePoints } from "../lib/format/outline.js";
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
  translateZone,
  setSnapPoints,
  snapBetween,
  applyBrush,
  pushHistory,
} from "../lib/stores/editor.js";
import {
  activeTool,
  brushRadius,
  brushStrength,
  drawZoneType,
  coverageOn,
  coverageSpacing,
  coverageAngle,
  coverageAbsolute,
  coveragePasses,
} from "../lib/stores/tools.js";
import { robotLive, robotPose } from "../lib/stores/robot.js";
import { wifiMapEnabled, wifiSamples } from "../lib/stores/wifi.js";
import { wifiSignalColor } from "../lib/wifi/signal.js";
import {
  resolveRobotVisualMode,
  robotVisualToMarkerStyle,
  buildRobotHudHtml,
  buildRobotHudLines,
  buildRobotPoseTooltip,
} from "../lib/robot/telemetry.js";
import { notify, setStatus } from "../lib/stores/toast.js";
import { activeBasemap } from "../lib/stores/basemap.js";

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
  const map = L.map(container, { zoomControl: false, maxZoom: 24 }).setView(
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
    overlays: [],
    points: [],
    multiHandle: null,
    moveHandle: null,
    snapGuide: null,
    boxSelect: null,
    brushCursor: null,
    drawPreview: null,
    coverage: [],
    dock: null,
    robot: null,
    wifiHeat: [],
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

  const origin = () => s.origin;

  // ---- rendering -----------------------------------------------------------

  function clearEditLayers() {
    if (layers.areaLine) map.removeLayer(layers.areaLine);
    layers.areaLine = null;
    layers.overlays.forEach((l) => map.removeLayer(l));
    layers.overlays = [];
    layers.coverage.forEach((l) => map.removeLayer(l));
    layers.coverage = [];
    layers.points.forEach((m) => map.removeLayer(m));
    layers.points = [];
    if (layers.multiHandle) map.removeLayer(layers.multiHandle);
    layers.multiHandle = null;
    if (layers.moveHandle) map.removeLayer(layers.moveHandle);
    layers.moveHandle = null;
    if (layers.snapGuide) map.removeLayer(layers.snapGuide);
    layers.snapGuide = null;
    if (layers.dock) map.removeLayer(layers.dock);
    layers.dock = null;
  }

  function drawOverlay(area, color) {
    const outline = area.outline || [];
    if (outline.length < 2) return;
    const latlngs = outline.map((p) => metersToLatLng(p, origin()));
    const closed = latlngs.length > 1 ? [...latlngs, latlngs[0]] : latlngs;
    const line = L.polyline(closed, {
      color,
      weight: 1.2,
      opacity: 0.95,
      dashArray: "4,4",
    }).addTo(map);
    layers.overlays.push(line);
  }

  function render() {
    clearEditLayers();
    const area = s.mapData?.areas?.[s.areaIndex];
    if (!area) {
      renderDock();
      return;
    }
    const type = getAreaType(area);
    const mowColor = cssVar("--map-line-mow", "#ffffff");
    const obstacleColor = cssVar("--map-line-obstacle", "#ef4444");
    const navColor = cssVar("--map-line-nav", "#38bdf8");
    const overlayMow = cssVar("--map-line-overlay-mow", mowColor);

    const pts = currentEditablePoints();
    const latlngs = pts.map((p) => metersToLatLng(p, origin()));
    const closed = latlngs.length > 1 ? [...latlngs, latlngs[0]] : latlngs;

    layers.areaLine = L.polyline(closed, {
      color: type === "obstacle" ? obstacleColor : type === "nav" ? navColor : mowColor,
      weight: type === "mow" ? 0.2 : 1.2,
      opacity: 0.95,
      dashArray: type === "mow" ? undefined : "4,4",
    }).addTo(map);

    // Type-aware overlays of the other zones.
    (s.mapData?.areas || []).forEach((other, i) => {
      if (i === s.areaIndex) return;
      const ot = getAreaType(other);
      if (type === "mow" && (ot === "obstacle" || ot === "nav")) {
        drawOverlay(other, ot === "nav" ? navColor : obstacleColor);
      } else if (type === "obstacle" && (ot === "mow" || ot === "nav")) {
        drawOverlay(other, ot === "nav" ? navColor : overlayMow);
      } else if (type === "nav" && (ot === "mow" || ot === "obstacle")) {
        drawOverlay(other, ot === "obstacle" ? obstacleColor : overlayMow);
      }
    });

    if (get(coverageOn) && type === "mow") renderCoverage(pts);
    renderPoints(pts, latlngs);
    renderMultiHandle(pts);
    if (tool === "move") renderMoveHandle(pts);
    renderSnapGuide(pts);
    renderDock();
    if (tool === "brush" && brushCursorLatLng) updateBrushCursor(brushCursorLatLng);
  }

  function renderWifiHeatmap(enabled, samples) {
    layers.wifiHeat.forEach((layer) => map.removeLayer(layer));
    layers.wifiHeat = [];
    if (!enabled || !s.origin || !Array.isArray(samples)) return;

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
          radius: 2.2,
          stroke: false,
          fill: true,
          fillColor: wifiSignalColor(sample.signalDbm),
          fillOpacity: 0.52,
          interactive: false,
        }).addTo(map)
      );
    }
  }

  function renderCoverage(pts) {
    const spacing = get(coverageSpacing);
    const laps = Math.max(0, Math.round(get(coveragePasses)));
    if (!(spacing > 0)) return;

    // Clean, lighter outline for offset rings on dense polygons.
    const base = pts.length > 60 ? simplify(pts, Math.min(0.1, spacing / 3)) : pts;
    if (base.length < 3) return;

    // mow_angle_offset, relative to the zone's main axis unless absolute.
    const offset = get(coverageAngle);
    const baseAngle = get(coverageAbsolute) ? 0 : principalAngleDeg(base);
    const angle = baseAngle + offset;

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

    // Perimeter laps the robot follows first (outline, then inset rings).
    let fillBoundary = base;
    for (let k = 0; k < laps; k += 1) {
      const ring = k === 0 ? base : offsetPolygon(base, k * spacing);
      if (ring.length < 3 || polygonArea(ring) < minArea) {
        fillBoundary = null;
        break;
      }
      const lls = ring.map((p) => metersToLatLng(p, origin()));
      layers.coverage.push(
        L.polyline([...lls, lls[0]], {
          color: perimColor,
          weight: 1.6,
          opacity: 0.85,
          interactive: false,
        }).addTo(map)
      );
      // Fill goes inside the innermost perimeter lap.
      const inner = offsetPolygon(base, (k + 1) * spacing);
      fillBoundary = inner.length >= 3 && polygonArea(inner) >= minArea ? inner : null;
    }

    // Back-and-forth fill stripes.
    if (fillBoundary) {
      const segs = coverageLines(fillBoundary, obstacles, spacing, angle);
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

  function renderMoveHandle(pts) {
    if (!pts.length) return;
    const c = centroid(pts);
    if (!c) return;
    const handle = L.marker(metersToLatLng(c, origin()), {
      draggable: true,
      icon: L.divIcon({
        className: "map-marker-leaflet",
        html: `<div class="map-marker--group"><span class="material-symbols-outlined">open_with</span></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
      title: "Drag to move the whole zone",
    }).addTo(map);
    let start = null;
    handle.on("dragstart", () => {
      suppressNextClick = true;
      ignoreClicksUntil = Date.now() + 700;
      start = latLngToMeters(handle.getLatLng(), origin());
      pushHistory();
    });
    handle.on("dragend", () => {
      ignoreClicksUntil = Date.now() + 700;
      if (!start) return;
      const end = latLngToMeters(handle.getLatLng(), origin());
      translateZone(end.x - start.x, end.y - start.y);
    });
    layers.moveHandle = handle;
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
        if (tool === "multi") {
          toggleMultiPoint(idx);
          return;
        }
        if (tool === "snap") {
          handleSnapClick(idx);
          return;
        }
        selectPoint(idx);
      });
      marker.on("dragstart", () => {
        suppressNextClick = true;
        ignoreClicksUntil = Date.now() + 700;
        pushHistory();
      });
      marker.on("dragend", (e) => {
        ignoreClicksUntil = Date.now() + 700;
        movePoint(idx, latLngToMeters(e.target.getLatLng(), origin()));
      });
      layers.points.push(marker);
    });
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
    const dock = L.marker(metersToLatLng(station.position, origin()), {
      draggable: true,
      icon: L.divIcon({
        className: "map-marker-leaflet",
        html: `<div class="map-marker--dock"><span class="material-symbols-outlined">ev_station</span></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
      title: "Dock / charging station (drag to move)",
    }).addTo(map);
    dock.on("click", (e) => L.DomEvent.stopPropagation(e));
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
  function moveBrush(latlng) {
    updateBrushCursor(latlng);
    if (!brushPainting || !brushPrev) return;
    const cur = latLngToMeters(latlng, origin());
    const delta = { x: cur.x - brushPrev.x, y: cur.y - brushPrev.y };
    if (delta.x !== 0 || delta.y !== 0) {
      brushMoved += applyBrush(cur, delta, get(brushRadius), get(brushStrength));
    }
    brushPrev = cur;
  }

  function endBrush() {
    if (!brushPainting) return;
    brushPainting = false;
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

  // ---- box select ----------------------------------------------------------

  function finishBox(end) {
    if (!boxStart) return;
    const bounds = L.latLngBounds(boxStart, end);
    const pts = currentEditablePoints();
    const selected = [];
    pts.forEach((p, i) => {
      if (bounds.contains(metersToLatLng(p, origin()))) selected.push(i);
    });
    setMultiSelection(selected);
    boxActive = false;
    boxStart = null;
    if (layers.boxSelect) {
      map.removeLayer(layers.boxSelect);
      layers.boxSelect = null;
    }
    map.dragging.enable();
    setStatus(`Box selected ${selected.length} point(s).`);
  }

  // ---- map-level handlers --------------------------------------------------

  map.on("click", (e) => {
    if (Date.now() < ignoreClicksUntil) return;
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const meters = latLngToMeters(e.latlng, origin());
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
      if (!s.mapData?.areas?.[s.areaIndex]) return;
      pushHistory();
      const idx = nearestEdgeInsertIndex(currentEditablePoints(), meters);
      insertPointAtIndex(idx, meters);
    }
  });

  map.on("mousedown", (e) => {
    if (tool === "brush") {
      if (e.originalEvent?.button != null && e.originalEvent.button !== 0) return;
      startBrush(e.latlng);
      return;
    }
    if (tool === "rect" || tool === "circle") {
      if (e.originalEvent?.button != null && e.originalEvent.button !== 0) return;
      startDraw(e.latlng);
      return;
    }
    if (tool !== "multi") return;
    if (!e.originalEvent?.shiftKey) return;
    boxActive = true;
    boxStart = e.latlng;
    map.dragging.disable();
    if (layers.boxSelect) map.removeLayer(layers.boxSelect);
    layers.boxSelect = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
      color: "#22d3ee",
      weight: 1,
      fillOpacity: 0.12,
      dashArray: "4,4",
    }).addTo(map);
  });

  map.on("mousemove", (e) => {
    if (tool === "brush") {
      moveBrush(e.latlng);
      return;
    }
    if (drawActive) {
      updateDraw(e.latlng);
      return;
    }
    if (boxActive && boxStart && layers.boxSelect) {
      layers.boxSelect.setBounds(L.latLngBounds(boxStart, e.latlng));
    }
  });

  map.on("mouseup", (e) => {
    if (tool === "brush" && brushPainting) {
      endBrush();
      return;
    }
    if (drawActive) {
      finishDraw(e.latlng);
      return;
    }
    if (boxActive) finishBox(e.latlng);
  });

  map.on("mouseout", () => {
    if (tool === "brush" && brushPainting) endBrush();
  });
  map.on("touchstart", (e) => tool === "brush" && startBrush(e.latlng));
  map.on("touchmove", (e) => tool === "brush" && moveBrush(e.latlng));
  map.on("touchend", () => tool === "brush" && brushPainting && endBrush());

  // ---- robot marker (separate subscription, avoids full re-render) ---------

  function renderRobot(live, pose) {
    if (!live || !pose || !pose.ok) {
      if (layers.robot) {
        map.removeLayer(layers.robot);
        layers.robot = null;
      }
      return;
    }
    const latlng = metersToLatLng({ x: pose.x, y: pose.y }, origin());
    const icon = makeRobotIcon(pose);
    const tooltip = buildRobotPoseTooltip(pose);
    if (!layers.robot) {
      layers.robot = L.marker(latlng, { icon, zIndexOffset: 800 })
        .bindTooltip(tooltip, {
          sticky: true,
          direction: "top",
          opacity: 0.95,
          className: "robot-tooltip",
        })
        .addTo(map);
    } else {
      layers.robot.setLatLng(latlng).setIcon(icon).setTooltipContent(tooltip);
    }
  }

  function makeRobotIcon(pose) {
    const visual = resolveRobotVisualMode(pose.ros);
    const { modifier, glyph } = robotVisualToMarkerStyle(visual);
    const telemetry = pose.ros?.telemetry || null;
    const rotationDeg = 90 - (pose.yaw * 180) / Math.PI;
    const yawCss = visual === "nav" ? `transform: rotate(${rotationDeg}deg)` : "transform: none";
    const hud = buildRobotHudHtml(telemetry);
    if (!hud) {
      return L.divIcon({
        className: "map-marker-leaflet",
        html: `<div class="map-marker--robot ${modifier}" style="${yawCss}"><span class="material-symbols-outlined">${glyph}</span></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
    }
    const stackW = 200;
    const lineCount = buildRobotHudLines(telemetry).length;
    const stackH = 40 + 4 + 6 + lineCount * 15;
    return L.divIcon({
      className: "map-marker-leaflet robot-marker-stack-wrap",
      html: `<div class="robot-marker-stack" style="width:${stackW}px"><div class="robot-marker-stack__pin"><div class="map-marker--robot ${modifier}" style="${yawCss}"><span class="material-symbols-outlined">${glyph}</span></div></div><div class="robot-marker-stack__hud">${hud}</div></div>`,
      iconSize: [stackW, stackH],
      iconAnchor: [stackW / 2, 20],
    });
  }

  // ---- public helpers ------------------------------------------------------

  function getCenterMeters() {
    return latLngToMeters(map.getCenter(), origin());
  }

  function fitCurrentArea() {
    const pts = currentEditablePoints();
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map((p) => metersToLatLng(p, origin())));
    // Cap the fit zoom so tiny areas don't overshoot into blank imagery
    // (Esri's detailed tiles run out at lower zoom in rural regions).
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { maxZoom: 20 });
  }

  function panToPoint(meters, zoom) {
    map.setView(metersToLatLng(meters, origin()), zoom || Math.max(map.getZoom(), 20));
  }

  // ---- store wiring --------------------------------------------------------

  const unsubs = [];
  unsubs.push(activeBasemap.subscribe((cfg) => applyBasemap(cfg)));
  unsubs.push(
    editor.subscribe((value) => {
      s = value;
      render();
      renderWifiHeatmap(get(wifiMapEnabled), get(wifiSamples));
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
      if (prev === "multi" && value !== "multi") {
        boxActive = false;
        boxStart = null;
        if (layers.boxSelect) {
          map.removeLayer(layers.boxSelect);
          layers.boxSelect = null;
        }
        map.dragging.enable();
      }
      // Crosshair cursor for click/drag-to-place tools.
      const crosshair = ["add", "brush", "snap", "rect", "circle", "dock"].includes(value);
      map.getContainer().style.cursor = crosshair ? "crosshair" : "";
      render();
    })
  );
  unsubs.push(
    robotPose.subscribe((pose) => renderRobot(get(robotLive), pose))
  );
  unsubs.push(robotLive.subscribe((live) => renderRobot(live, get(robotPose))));
  unsubs.push(
    wifiSamples.subscribe((samples) => renderWifiHeatmap(get(wifiMapEnabled), samples))
  );
  unsubs.push(
    wifiMapEnabled.subscribe((enabled) => renderWifiHeatmap(enabled, get(wifiSamples)))
  );
  unsubs.push(coverageOn.subscribe(() => render()));
  unsubs.push(coverageSpacing.subscribe(() => render()));
  unsubs.push(coverageAngle.subscribe(() => render()));
  unsubs.push(coverageAbsolute.subscribe(() => render()));
  unsubs.push(coveragePasses.subscribe(() => render()));

  // Keep Leaflet sized correctly once laid out.
  setTimeout(() => map.invalidateSize(), 60);

  return {
    map,
    getCenterMeters,
    fitCurrentArea,
    panToPoint,
    zoomIn: () => map.zoomIn(),
    zoomOut: () => map.zoomOut(),
    invalidateSize: () => map.invalidateSize(),
    destroy() {
      unsubs.forEach((u) => u());
      map.remove();
    },
  };
}
