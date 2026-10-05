// Pure calendar helpers for the movement-trail date picker: which local days
// have recorded trail data, a Monday-first month grid, and jumping between
// days that have data. No DOM.

/** Local "YYYY-MM-DD" calendar-day key for a timestamp. */
export function dateKeyOf(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Days with trail data: every archived session's start day (matching how the
 * picker loads a day), plus today while the live history has points.
 * @param {Array<{startedAt:number, pointCount?:number}>} sessions
 */
export function dataDayKeys(sessions, todayKey, hasTodayPoints) {
  const days = new Set();
  for (const s of sessions || []) {
    if (!Number.isFinite(s?.startedAt)) continue;
    if (s.pointCount != null && !(s.pointCount > 0)) continue;
    days.add(dateKeyOf(s.startedAt));
  }
  if (hasTodayPoints) days.add(todayKey);
  return days;
}

/**
 * Weeks (Monday first) covering `month` (0-11) of `year`; each cell is
 * { key, day, inMonth }. Leading / trailing cells belong to the neighbour months.
 */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const weeks = [];
  for (let i = 0; i < cells; i += 1) {
    const d = new Date(year, month, 1 - lead + i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ key: dateKeyOf(d.getTime()), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return weeks;
}

/** Nearest day with data before (dir < 0) or after (dir > 0) `fromKey`, or null. */
export function adjacentDataDay(days, fromKey, dir) {
  const sorted = [...days].sort();
  if (dir < 0) {
    for (let i = sorted.length - 1; i >= 0; i -= 1) if (sorted[i] < fromKey) return sorted[i];
  } else {
    for (const k of sorted) if (k > fromKey) return k;
  }
  return null;
}
