import { writable } from "svelte/store";

// A writable that persists to localStorage (numbers and booleans).
function persisted(key, initial) {
  let start = initial;
  if (typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(key);
    if (raw != null) {
      if (raw === "true") start = true;
      else if (raw === "false") start = false;
      else {
        const n = Number(raw);
        start = Number.isFinite(n) ? n : initial;
      }
    }
  }
  const store = writable(start);
  if (typeof localStorage !== "undefined") {
    store.subscribe((v) => localStorage.setItem(key, String(v)));
  }
  return store;
}

// Exactly one editing tool is active at a time. "none" is the default
// direct-edit mode (drag a vertex, click to select).
// Tools: none | multi | add | brush | snap | move | rect | circle | dock
export const activeTool = writable("none");

export const brushRadius = writable(0.35);
// 0..1 follow factor — how strongly points track the drag at the brush center.
export const brushStrength = writable(0.7);
export const simplifyTolerance = writable(0.05);

// Zone type used by the rectangle / circle draw tools.
export const drawZoneType = writable("mow");

// Mowing coverage preview toggle. The parameters now come from the robot's
// real /mower_logic values (mowParams store) + per-area map.json overrides,
// so there are no manual sliders here anymore.
export const coverageOn = persisted("om-coverage-on", false);

export function setTool(tool) {
  activeTool.set(tool);
}

export function toggleTool(tool) {
  activeTool.update((current) => (current === tool ? "none" : tool));
}
