// The mower's sensors for the Robot tab: xbot_monitoring's sensor list (as
// streamed by the server, see sensorFrameToSensor in server.js) plus the robot
// state's own values, grouped and formatted. Pure — no DOM.

// xbot_monitoring reports GPS accuracy as 999 m while there's no fix.
const NO_FIX_M = 100;

const GROUPS = [
  { id: "power", title: "Power" },
  { id: "position", title: "Position" },
  { id: "motors", title: "Motors" },
  { id: "safety", title: "Safety" },
  { id: "other", title: "Other" },
];

/**
 * "crit" beyond a critical limit, else "ok". The robot's min/max are a display
 * range (a cold mow motor sits below it), so only critical limits count, and
 * an idle reading of exactly 0 (blade off) doesn't trip a critical-low.
 */
export function sensorLevel(sensor) {
  const v = sensor?.value;
  if (typeof v !== "number") return "ok";
  if (sensor.critHigh != null && v > sensor.critHigh) return "crit";
  if (sensor.critLow != null && v !== 0 && v < sensor.critLow) return "crit";
  return "ok";
}

export function formatSensorValue(sensor) {
  const v = sensor?.value;
  if (typeof v !== "number") return String(v ?? "");
  switch (sensor.kind) {
    case "distance":
      if (v >= NO_FIX_M) return "no fix";
      return v < 1 ? `${Math.round(v * 100)} cm` : `${v.toFixed(2)} m`;
    case "temperature":
      return `${v.toFixed(1)} °C`;
    case "voltage":
    case "current":
      return `${v.toFixed(2)} ${sensor.unit}`;
    case "rpm":
      return `${Math.round(v)} rpm`;
    case "percent":
      return `${Math.round(v)}%`;
    default:
      return `${Math.round(v * 100) / 100}${sensor.unit ? ` ${sensor.unit}` : ""}`;
  }
}

function groupOf(sensor) {
  const key = `${sensor.id} ${sensor.name}`.toLowerCase();
  if (sensor.kind === "voltage" || key.includes("charge") || key.includes("battery")) return "power";
  if (sensor.kind === "distance" || key.includes("gps")) return "position";
  if (["temperature", "current", "rpm"].includes(sensor.kind)) return "motors";
  return "other";
}

/** Rows grouped as Power / Position / Motors / Safety / Other, empty groups left out. */
export function sensorGroups(sensors, telemetry) {
  const rows = Object.fromEntries(GROUPS.map((g) => [g.id, []]));
  const t = telemetry || {};
  if (Number.isFinite(t.batteryPercent)) {
    rows.power.push({ label: "Battery", value: `${Math.round(t.batteryPercent)}%`, level: t.batteryPercent < 20 ? "warn" : "ok" });
  }
  if (typeof t.isCharging === "boolean") rows.power.push({ label: "Charging", value: t.isCharging ? "yes" : "no", level: "ok" });
  if (Number.isFinite(t.gpsQualityPercent)) {
    rows.position.push({ label: "GPS quality", value: `${Math.round(t.gpsQualityPercent)}%`, level: "ok" });
  }
  for (const s of sensors || []) {
    rows[groupOf(s)].push({ label: s.name, value: formatSensorValue(s), level: sensorLevel(s) });
  }
  if (typeof t.emergency === "boolean") {
    rows.safety.push({ label: "Emergency", value: t.emergency ? "STOP" : "OK", level: t.emergency ? "crit" : "ok" });
  }
  if (typeof t.rainDetected === "boolean") {
    rows.safety.push({ label: "Rain", value: t.rainDetected ? "yes" : "no", level: t.rainDetected ? "warn" : "ok" });
  }
  return GROUPS.filter((g) => rows[g.id].length).map((g) => ({ id: g.id, title: g.title, rows: rows[g.id] }));
}
