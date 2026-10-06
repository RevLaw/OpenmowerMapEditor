import { writable, derived } from "svelte/store";
import { robotTrail, robotTrailDisplayPoints } from "./robotTrail.js";
import { slicePath, pathToOutline } from "../robot/recorder.js";

// "Trail → zone": pick a stretch of the live breadcrumb or the saved trail
// history (by start/end fraction), preview its simplified outline on the map,
// and create a zone from it. Open state drives the map preview.
export const trailZone = writable({
  open: false,
  source: "history", // "history" (saved, per day) | "live" (this session's breadcrumb)
  start: 0,
  end: 1,
  tolerance: 0.1,
  type: "mow",
});

/** The raw path for the chosen source and range. */
export const trailZonePath = derived(
  [trailZone, robotTrail, robotTrailDisplayPoints],
  ([$tz, $live, $history]) => {
    if (!$tz.open) return [];
    return slicePath($tz.source === "live" ? $live : $history, $tz.start, $tz.end);
  }
);

/** Simplified outline the zone would get (null = not a usable polygon). */
export const trailZoneOutline = derived([trailZone, trailZonePath], ([$tz, $path]) =>
  $tz.open ? pathToOutline($path, $tz.tolerance) : null
);

export function setTrailZone(patch) {
  trailZone.update((tz) => ({ ...tz, ...patch }));
}
