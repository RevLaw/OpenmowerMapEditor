import { writable } from "svelte/store";

// Top-level overlay visibility, so deeply-nested buttons can open modals that
// must render outside transformed/overflow-clipped containers (e.g. the sidebar).
export const backupsOpen = writable(false);

/** Confirm-before-save dialog: null (closed) or { restart:boolean }. */
export const saveDialog = writable(null);

/**
 * Right-click / long-press menu: null (closed) or
 * { x, y, title?, items: Array<{label, icon, run, danger?, disabled?} | "divider"> }
 * with x/y in viewport pixels.
 */
export const contextMenu = writable(null);

const TAB_KEY = "om-sidebar-tab";
function initialTab() {
  try {
    const t = typeof localStorage !== "undefined" ? localStorage.getItem(TAB_KEY) : null;
    return ["zones", "map", "robot"].includes(t) ? t : "zones";
  } catch (_e) {
    return "zones";
  }
}

/** Active sidebar tab: "zones" | "map" | "robot". */
export const sidebarTab = writable(initialTab());
sidebarTab.subscribe((t) => {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(TAB_KEY, t);
  } catch (_e) {
    /* ignore */
  }
});
