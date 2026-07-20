// Thin fetch wrappers around the Express backend. Endpoints and shapes match
// server.js exactly and must not drift.

/** GET /api/params -> { lat, lng } datum origin. Throws if unavailable. */
export async function fetchParams() {
  const res = await fetch("/api/params");
  if (!res.ok) throw new Error("No params found.");
  const data = await res.json();
  if (!Number.isFinite(data.datumLat) || !Number.isFinite(data.datumLng)) {
    throw new Error("Params missing datum.");
  }
  return { lat: data.datumLat, lng: data.datumLng };
}

/** GET /api/map -> raw map.json text. Throws if not present. */
export async function fetchActiveMap() {
  const res = await fetch("/api/map");
  if (!res.ok) throw new Error("No map found.");
  return res.text();
}

/** GET /api/map/backups -> string[] of available map files. */
export async function fetchBackups() {
  const res = await fetch("/api/map/backups");
  if (!res.ok) throw new Error("Failed to list backups.");
  const payload = await res.json();
  return Array.isArray(payload.backups) ? payload.backups : [];
}

/** GET /api/map/backups/:name -> raw map text. */
export async function fetchBackup(name) {
  const res = await fetch(`/api/map/backups/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error("Map file load failed.");
  return res.text();
}

/** POST /api/map(?restart=1) -> save result JSON. Throws on failure. */
export async function saveMap(map, { restart = false } = {}) {
  const url = restart ? "/api/map?restart=1" : "/api/map";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(map),
  });
  if (!res.ok) throw new Error("Server save failed.");
  return res.json();
}

/** GET /api/robot_pose -> pose + telemetry payload. */
export async function fetchRobotPose() {
  const res = await fetch("/api/robot_pose");
  return res.json();
}

/** GET /api/mow_params -> global mowing params from /mower_logic (or fallback). */
export async function fetchMowParams() {
  const res = await fetch("/api/mow_params");
  return res.json();
}

/** POST /api/plan_path -> exact coverage path from OpenMower's slic3r planner. */
export async function planPath(payload) {
  const res = await fetch("/api/plan_path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}
