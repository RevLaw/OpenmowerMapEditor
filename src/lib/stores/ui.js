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

const SIDEBAR_KEY = "om-sidebar-open";
const NARROW_PX = 1024;

/** Narrow screens (phones, small tablets): the open sidebar covers the map. */
export function isNarrowScreen() {
  return typeof window !== "undefined" && window.innerWidth < NARROW_PX;
}

function initialSidebarOpen() {
  if (typeof window === "undefined") return true;
  // Phones always start folded so the map gets the screen; desktops remember.
  if (isNarrowScreen()) return false;
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "0";
  } catch (_e) {
    return true;
  }
}

/** Left sidebar unfolded (true) or folded to the icon rail (false). */
export const sidebarOpen = writable(initialSidebarOpen());
sidebarOpen.subscribe((open) => {
  if (isNarrowScreen()) return;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
  } catch (_e) {
    /* ignore */
  }
});

/** Unfold the sidebar on a given tab (from the folded rail). */
export function openSidebarTab(tab) {
  sidebarTab.set(tab);
  sidebarOpen.set(true);
}
