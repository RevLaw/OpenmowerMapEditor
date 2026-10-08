// Single registry of user commands. The command palette renders these and the
// keyboard shortcuts dispatch them, so buttons / shortcuts / palette never drift.
import { get } from "svelte/store";
import { setTool, toggleTool, coverageOn } from "./stores/tools.js";
import { toggleTheme } from "./stores/theme.js";
import { toggleRobotLive } from "./stores/robot.js";
import { openDriveScreen } from "./stores/driveScreen.js";
import { mapApi } from "./stores/mapApi.js";
import { basemapId, BASEMAPS } from "./stores/basemap.js";
import { backupsOpen, sidebarTab, sidebarOpen } from "./stores/ui.js";
import { snapEnabled } from "./stores/tools.js";
import { editor, setAreaIndex } from "./stores/editor.js";
import { toggleZoneLocked, toggleZoneHidden, showAllZones } from "./stores/zoneView.js";
import {
  requestSave,
  exportMap,
  setDockFromRobot,
  addRobotPointToZone,
  undo,
  redo,
  removePoint,
  addZoneAtCenter,
  removeCurrentZone,
  duplicateZoneAction,
  simplifyZoneAction,
  selectAllPointsAction,
  changeZoneType,
  moveZoneOrder,
} from "./actions.js";

/**
 * @param {{ openCheatSheet?: () => void }} ctx
 * @returns {Array<{id,title,group,icon,shortcut?,run:Function}>}
 */
export function getCommands(ctx = {}) {
  const fit = () => get(mapApi)?.fitCurrentArea();
  const withZone = (fn) => {
    const s = get(editor);
    const area = s.mapData?.areas?.[s.areaIndex];
    if (area) fn(area, s.areaIndex);
  };
  const cycle = (dir) => {
    const s = get(editor);
    const n = s.mapData?.areas?.length || 0;
    if (!n) return;
    setAreaIndex((s.areaIndex + dir + n) % n);
    fit();
  };
  return [
    // File
    { id: "backups", title: "Load map / backup…", group: "File", icon: "history", run: () => backupsOpen.set(true) },
    { id: "save", title: "Save map.json…", group: "File", icon: "save", shortcut: "Ctrl S", run: () => requestSave({ restart: false }) },
    { id: "save-restart", title: "Save + restart ROS…", group: "File", icon: "restart_alt", run: () => requestSave({ restart: true }) },
    { id: "export-geojson", title: "Export as GeoJSON", group: "File", icon: "download", run: () => exportMap("geojson") },
    { id: "export-kml", title: "Export as KML", group: "File", icon: "download", run: () => exportMap("kml") },
    { id: "import", title: "Import GeoJSON / KML…", group: "File", icon: "add_location_alt", run: () => sidebarTab.set("map") },

    // Edit
    { id: "undo", title: "Undo", group: "Edit", icon: "undo", shortcut: "Ctrl Z", run: undo },
    { id: "redo", title: "Redo", group: "Edit", icon: "redo", shortcut: "Ctrl ⇧ Z", run: redo },
    { id: "remove-point", title: "Remove selected point(s)", group: "Edit", icon: "delete", shortcut: "Del", run: removePoint },

    // Tools
    { id: "tool-select", title: "Tool: Select / drag (Shift: add to selection / box)", group: "Tools", icon: "near_me", shortcut: "V", run: () => setTool("none") },
    { id: "select-all", title: "Select all points of the zone", group: "Edit", icon: "select_all", shortcut: "Ctrl A", run: selectAllPointsAction },
    { id: "tool-add", title: "Tool: Add point", group: "Tools", icon: "add_location_alt", shortcut: "A", run: () => toggleTool("add") },
    { id: "tool-brush", title: "Tool: Push brush", group: "Tools", icon: "blur_circular", shortcut: "B", run: () => toggleTool("brush") },
    { id: "tool-snap", title: "Tool: Snap line", group: "Tools", icon: "horizontal_rule", shortcut: "S", run: () => toggleTool("snap") },
    { id: "tool-split", title: "Tool: Split zone along a line", group: "Tools", icon: "content_cut", shortcut: "X", run: () => toggleTool("split") },
    { id: "tool-ruler", title: "Tool: Measure distance", group: "Tools", icon: "straighten", shortcut: "D", run: () => toggleTool("ruler") },
    { id: "snap-toggle", title: "Toggle snapping to other zones", group: "Tools", icon: "adjust", run: () => snapEnabled.update((v) => !v) },

    // Draw / create
    { id: "tool-poly", title: "Draw polygon zone", group: "Create", icon: "polyline", shortcut: "P", run: () => toggleTool("poly") },
    { id: "tool-rect", title: "Draw rectangle zone", group: "Create", icon: "crop_square", shortcut: "R", run: () => toggleTool("rect") },
    { id: "tool-circle", title: "Draw circle zone", group: "Create", icon: "circle", shortcut: "O", run: () => toggleTool("circle") },
    { id: "tool-dock", title: "Place docking station", group: "Create", icon: "ev_station", run: () => toggleTool("dock") },
    { id: "zone-duplicate", title: "Duplicate selected zone", group: "Create", icon: "content_copy", shortcut: "Ctrl D", run: duplicateZoneAction },
    { id: "record", title: "Record a boundary by driving…", group: "Create", icon: "radio_button_checked", run: () => sidebarTab.set("robot") },
    { id: "robot-vertex", title: "Add robot position as vertex", group: "Create", icon: "my_location", run: addRobotPointToZone },
    { id: "dock-robot", title: "Set dock from robot pose", group: "Create", icon: "ev_station", run: setDockFromRobot },

    // Zones
    { id: "zone-add-mow", title: "Add mow zone", group: "Zones", icon: "grass", run: () => addZoneAtCenter("mow") },
    { id: "zone-add-obstacle", title: "Add obstacle zone", group: "Zones", icon: "block", run: () => addZoneAtCenter("obstacle") },
    { id: "zone-add-nav", title: "Add nav zone", group: "Zones", icon: "route", run: () => addZoneAtCenter("nav") },
    { id: "zone-remove", title: "Remove selected zone", group: "Zones", icon: "remove_circle", run: removeCurrentZone },
    { id: "zone-type-mow", title: "Set zone type: mow", group: "Zones", icon: "grass", run: () => changeZoneType("mow") },
    { id: "zone-type-obstacle", title: "Set zone type: obstacle", group: "Zones", icon: "block", run: () => changeZoneType("obstacle") },
    { id: "zone-type-nav", title: "Set zone type: nav", group: "Zones", icon: "route", run: () => changeZoneType("nav") },
    { id: "zone-up", title: "Move zone up (reorder)", group: "Zones", icon: "arrow_upward", run: () => moveZoneOrder(-1) },
    { id: "zone-down", title: "Move zone down (reorder)", group: "Zones", icon: "arrow_downward", run: () => moveZoneOrder(1) },
    { id: "zone-prev", title: "Select previous zone", group: "Zones", icon: "skip_previous", shortcut: "[", run: () => cycle(-1) },
    { id: "zone-next", title: "Select next zone", group: "Zones", icon: "skip_next", shortcut: "]", run: () => cycle(1) },
    { id: "zone-lock", title: "Lock / unlock selected zone", group: "Zones", icon: "lock", shortcut: "L", run: () => withZone(toggleZoneLocked) },
    { id: "zone-hide", title: "Hide / show selected zone", group: "Zones", icon: "visibility_off", shortcut: "H", run: () => withZone(toggleZoneHidden) },
    { id: "zone-show-all", title: "Show all hidden zones", group: "Zones", icon: "visibility", run: showAllZones },

    // Outline
    { id: "zone-simplify", title: "Simplify zone outline", group: "Edit", icon: "compress", run: simplifyZoneAction },

    // View
    { id: "fit", title: "Fit selected zone", group: "View", icon: "fit_screen", shortcut: "F", run: fit },
    { id: "fit-all", title: "Fit whole map", group: "View", icon: "zoom_out_map", shortcut: "⇧ F", run: () => get(mapApi)?.fitAll() },
    { id: "sidebar", title: "Fold / unfold side panel", group: "View", icon: "left_panel_close", shortcut: "Ctrl B", run: () => sidebarOpen.update((v) => !v) },
    { id: "drive", title: "Drive the mower (joystick)…", group: "View", icon: "sports_esports", run: () => { sidebarTab.set("robot"); sidebarOpen.set(true); } },
    { id: "theme", title: "Toggle light / dark theme", group: "View", icon: "contrast", run: toggleTheme },
    { id: "robot", title: "Toggle live robot overlay", group: "View", icon: "radar", run: toggleRobotLive },
    { id: "drive-screen", title: "Drive the mower (fullscreen drive screen)", group: "View", icon: "sports_esports", run: () => openDriveScreen() },
    { id: "coverage", title: "Toggle mowing coverage preview", group: "View", icon: "grid_on", run: () => coverageOn.update((v) => !v) },
    { id: "shortcuts", title: "Keyboard shortcuts", group: "View", icon: "keyboard", shortcut: "?", run: () => ctx.openCheatSheet?.() },

    // Map
    { id: "zoom-in", title: "Zoom in", group: "Map", icon: "add", shortcut: "+", run: () => get(mapApi)?.zoomIn() },
    { id: "zoom-out", title: "Zoom out", group: "Map", icon: "remove", shortcut: "−", run: () => get(mapApi)?.zoomOut() },
    ...BASEMAPS.map((b) => ({
      id: `basemap-${b.id}`,
      title: `Base map: ${b.label}`,
      group: "Map",
      icon: "layers",
      run: () => basemapId.set(b.id),
    })),
  ];
}
