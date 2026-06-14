// Single registry of user commands. The command palette renders these and the
// keyboard shortcuts dispatch them, so buttons / shortcuts / palette never drift.
import { get } from "svelte/store";
import { setTool, toggleTool, coverageOn } from "./stores/tools.js";
import { toggleTheme } from "./stores/theme.js";
import { toggleRobotLive } from "./stores/robot.js";
import { mapApi } from "./stores/mapApi.js";
import { backupsOpen } from "./stores/ui.js";
import {
  saveCurrent,
  undo,
  redo,
  removePoint,
  addZoneAtCenter,
  removeCurrentZone,
  duplicateZoneAction,
  simplifyZoneAction,
  rotateZone,
  scaleZone,
  changeZoneType,
  moveZoneOrder,
} from "./actions.js";

/**
 * @param {{ openCheatSheet?: () => void }} ctx
 * @returns {Array<{id,title,group,icon,shortcut?,run:Function}>}
 */
export function getCommands(ctx = {}) {
  const fit = () => get(mapApi)?.fitCurrentArea();
  return [
    // File
    { id: "backups", title: "Load map / backup…", group: "File", icon: "history", run: () => backupsOpen.set(true) },
    { id: "save", title: "Save map.json", group: "File", icon: "save", shortcut: "Ctrl S", run: () => saveCurrent({ restart: false }) },
    { id: "save-restart", title: "Save + restart ROS", group: "File", icon: "restart_alt", run: () => saveCurrent({ restart: true }) },

    // Edit
    { id: "undo", title: "Undo", group: "Edit", icon: "undo", shortcut: "Ctrl Z", run: undo },
    { id: "redo", title: "Redo", group: "Edit", icon: "redo", shortcut: "Ctrl ⇧ Z", run: redo },
    { id: "remove-point", title: "Remove selected point(s)", group: "Edit", icon: "delete", shortcut: "Del", run: removePoint },

    // Tools
    { id: "tool-select", title: "Tool: Select / drag", group: "Tools", icon: "near_me", shortcut: "V", run: () => setTool("none") },
    { id: "tool-add", title: "Tool: Add point", group: "Tools", icon: "add_location_alt", shortcut: "A", run: () => toggleTool("add") },
    { id: "tool-brush", title: "Tool: Push brush", group: "Tools", icon: "blur_circular", shortcut: "B", run: () => toggleTool("brush") },
    { id: "tool-snap", title: "Tool: Snap line", group: "Tools", icon: "horizontal_rule", shortcut: "S", run: () => toggleTool("snap") },
    { id: "tool-multi", title: "Tool: Multi-select", group: "Tools", icon: "select_all", shortcut: "M", run: () => toggleTool("multi") },
    { id: "tool-move", title: "Tool: Move whole zone", group: "Tools", icon: "open_with", shortcut: "G", run: () => toggleTool("move") },

    // Draw / create
    { id: "tool-rect", title: "Draw rectangle zone", group: "Create", icon: "crop_square", shortcut: "R", run: () => toggleTool("rect") },
    { id: "tool-circle", title: "Draw circle zone", group: "Create", icon: "circle", shortcut: "O", run: () => toggleTool("circle") },
    { id: "tool-dock", title: "Place docking station", group: "Create", icon: "ev_station", run: () => toggleTool("dock") },
    { id: "zone-duplicate", title: "Duplicate selected zone", group: "Create", icon: "content_copy", shortcut: "Ctrl D", run: duplicateZoneAction },

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

    // Transform
    { id: "zone-rotate-cw", title: "Rotate zone +15°", group: "Transform", icon: "rotate_right", run: () => rotateZone(15) },
    { id: "zone-rotate-ccw", title: "Rotate zone −15°", group: "Transform", icon: "rotate_left", run: () => rotateZone(-15) },
    { id: "zone-scale-up", title: "Scale zone +5%", group: "Transform", icon: "zoom_out_map", run: () => scaleZone(1.05) },
    { id: "zone-scale-down", title: "Scale zone −5%", group: "Transform", icon: "zoom_in_map", run: () => scaleZone(0.95) },
    { id: "zone-simplify", title: "Simplify zone outline", group: "Transform", icon: "compress", run: simplifyZoneAction },

    // View
    { id: "fit", title: "Fit selected zone", group: "View", icon: "fit_screen", shortcut: "F", run: fit },
    { id: "theme", title: "Toggle light / dark theme", group: "View", icon: "contrast", run: toggleTheme },
    { id: "robot", title: "Toggle live robot overlay", group: "View", icon: "radar", run: toggleRobotLive },
    { id: "coverage", title: "Toggle mowing coverage preview", group: "View", icon: "grid_on", run: () => coverageOn.update((v) => !v) },
    { id: "shortcuts", title: "Keyboard shortcuts", group: "View", icon: "keyboard", shortcut: "?", run: () => ctx.openCheatSheet?.() },
  ];
}
