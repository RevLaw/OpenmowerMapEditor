import { writable } from "svelte/store";
import { fetchMowParams } from "../api.js";

// Global mowing parameters (from /mower_logic; tool_width is the blade width).
// Per-area overrides live in map.json (area.properties) — see mapFormat.
// Defaults mirror OpenMower's MowerLogic.cfg for offline use.
export const MOW_DEFAULTS = {
  toolWidth: 0.14,
  outlineCount: 3,
  outlineOverlapCount: 0,
  outlineOffset: 0,
  mowAngleOffset: 0,
  mowAngleOffsetIsAbsolute: false,
  source: "default",
};

export const mowParams = writable({ ...MOW_DEFAULTS });

/** Fetch the live/global params once (best-effort; keeps defaults on failure). */
export async function loadMowParams() {
  try {
    const p = await fetchMowParams();
    if (p && p.ok !== false) mowParams.set({ ...MOW_DEFAULTS, ...p });
  } catch (_e) {
    /* keep defaults */
  }
}
