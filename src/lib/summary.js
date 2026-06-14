// Lightweight map summaries + backup-name helpers for the backups gallery.
import { getAreaType } from "./format/mapFormat.js";
import { getEditablePoints } from "./format/outline.js";
import { totalMowArea } from "./measurements.js";

/** Compact stats for a map: zone counts by type, total points, net mow area. */
export function mapSummary(map) {
  const areas = map?.areas || [];
  const byType = { mow: 0, obstacle: 0, nav: 0 };
  let points = 0;
  for (const a of areas) {
    const t = getAreaType(a);
    if (byType[t] != null) byType[t] += 1;
    points += getEditablePoints(a.outline || []).length;
  }
  return {
    zones: areas.length,
    byType,
    points,
    mowArea: totalMowArea(areas).net,
    hasDock: Boolean(map?.docking_stations?.[0]?.position),
  };
}

/** Parse the timestamp out of a `map.json.bak-<iso>` filename. */
export function parseBackupDate(name) {
  const m = name.match(/bak-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "just now" / "12 min ago" / "3 h ago" / "5 d ago". */
export function relativeTime(date) {
  if (!date) return "";
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
