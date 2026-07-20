import { writable, get } from "svelte/store";
import { planPath } from "../api.js";
import { editor } from "./editor.js";
import { mowParams } from "./mowParams.js";
import { coverageOn } from "./tools.js";
import { buildPlanRequest, parsePlanResponse } from "../coverage/planRequest.js";
import { notify, setStatus } from "./toast.js";

// The last computed exact path (or null). Stamped with the editor rev + areaIndex
// it was planned for, so the UI can flag it as stale after further edits.
export const exactPath = writable(null); // { paths, stats, rev, areaIndex } | null
export const exactPathLoading = writable(false);

/** Plan the currently selected mow zone via OpenMower's real coverage planner. */
export async function computeExactPath() {
  const s = get(editor);
  const areas = s.mapData?.areas || [];
  const areaIndex = s.areaIndex;
  const request = buildPlanRequest(areaIndex, areas, get(mowParams));
  if (!request) {
    setStatus("Select a mow zone with a valid outline first.");
    return;
  }
  exactPathLoading.set(true);
  try {
    const parsed = parsePlanResponse(await planPath(request));
    if (!parsed.ok) {
      notify(`Exact path: ${parsed.error}`, "warn");
      return;
    }
    if (!parsed.paths.length) {
      notify("Exact path: planner returned no path for this zone.", "warn");
      return;
    }
    exactPath.set({ ...parsed, rev: s.rev, areaIndex });
    // Hide the approximate overlay so the two paths don't overlap in the view.
    coverageOn.set(false);
    const st = parsed.stats || {};
    setStatus(`Exact path: ${st.laps ?? "?"} outline · ${st.fillRows ?? "?"} fill · ${st.points ?? 0} pts`);
  } catch (_e) {
    notify("Exact path: request failed (server or planner unreachable).", "warn");
  } finally {
    exactPathLoading.set(false);
  }
}

export function clearExactPath() {
  exactPath.set(null);
}
