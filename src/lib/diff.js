// Zone-level diff between two maps (last loaded/saved vs. current), shown in
// the confirm-before-save dialog. Zones are matched by id, falling back to
// list position for legacy zones without one.
import { getAreaType, getZoneName, ZONE_OVERRIDE_KEYS } from "./format/mapFormat.js";
import { getEditablePoints } from "./format/outline.js";
import { polygonArea, distance } from "./geo/geometry.js";
import { formatArea } from "./measurements.js";

const AREA_EPS = 0.05; // m²
const MOVE_EPS = 0.005; // m

function keyed(map) {
  const out = new Map();
  (map?.areas || []).forEach((area, i) => {
    out.set(area.id ? `id:${area.id}` : `idx:${i}`, { area, index: i });
  });
  return out;
}

function sameOutline(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i].x - b[i].x) > 1e-9 || Math.abs(a[i].y - b[i].y) > 1e-9) return false;
  }
  return true;
}

function describeChanges(before, after) {
  const changes = [];
  const tb = getAreaType(before);
  const ta = getAreaType(after);
  if (tb !== ta) changes.push(`type ${tb} → ${ta}`);
  const nb = before.properties?.name?.trim() || "";
  const na = after.properties?.name?.trim() || "";
  if (nb !== na) changes.push(na ? `renamed to "${na}"` : "name cleared");
  const pb = getEditablePoints(before.outline || []);
  const pa = getEditablePoints(after.outline || []);
  if (!sameOutline(pb, pa)) {
    const dp = pa.length - pb.length;
    const da = polygonArea(pa) - polygonArea(pb);
    let text = "outline edited";
    if (dp) text += `, ${dp > 0 ? "+" : "−"}${Math.abs(dp)} pts`;
    if (Math.abs(da) >= AREA_EPS) text += `, ${da > 0 ? "+" : "−"}${formatArea(Math.abs(da))}`;
    changes.push(text);
  }
  const overridesChanged = ZONE_OVERRIDE_KEYS.some(
    (k) => (before.properties?.[k] ?? null) !== (after.properties?.[k] ?? null)
  );
  if (overridesChanged) changes.push("mowing settings changed");
  return changes;
}

/**
 * @returns {{added:Array<{label,type}>, removed:Array<{label,type}>,
 *   changed:Array<{label,type,changes:string[]}>, reordered:boolean,
 *   dock:string|null, projectionChanged:boolean, empty:boolean}}
 */
export function diffMaps(base, next) {
  const before = keyed(base);
  const after = keyed(next);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, { area, index }] of after) {
    const label = getZoneName(area, index);
    if (!before.has(key)) {
      added.push({ label, type: getAreaType(area) });
      continue;
    }
    const changes = describeChanges(before.get(key).area, area);
    if (changes.length) changed.push({ label, type: getAreaType(area), changes });
  }
  for (const [key, { area, index }] of before) {
    if (!after.has(key)) removed.push({ label: getZoneName(area, index), type: getAreaType(area) });
  }
  const commonOrderBefore = [...before.keys()].filter((k) => after.has(k));
  const commonOrderAfter = [...after.keys()].filter((k) => before.has(k));
  const reordered = commonOrderBefore.some((k, i) => k !== commonOrderAfter[i]);

  let dock = null;
  const db = base?.docking_stations?.[0];
  const dn = next?.docking_stations?.[0];
  if (!db?.position && dn?.position) dock = "docking station added";
  else if (db?.position && !dn?.position) dock = "docking station removed";
  else if (db?.position && dn?.position) {
    const parts = [];
    const moved = distance(db.position, dn.position);
    if (moved > MOVE_EPS) parts.push(`moved ${moved.toFixed(2)} m`);
    const hb = Number.isFinite(db.heading) ? db.heading : null;
    const hn = Number.isFinite(dn.heading) ? dn.heading : null;
    if (hb !== hn && (hb == null || hn == null || Math.abs(hb - hn) > 1e-4)) parts.push("heading changed");
    if (parts.length) dock = `docking station ${parts.join(", ")}`;
  }

  const projectionChanged =
    base?.__editor?.originLat !== next?.__editor?.originLat ||
    base?.__editor?.originLng !== next?.__editor?.originLng;

  return {
    added,
    removed,
    changed,
    reordered,
    dock,
    projectionChanged,
    empty: !added.length && !removed.length && !changed.length && !reordered && !dock && !projectionChanged,
  };
}
