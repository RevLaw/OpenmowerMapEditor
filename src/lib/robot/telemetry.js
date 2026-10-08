// Pure helpers for the live robot overlay — visual-mode resolution, HUD label
// lines, and tooltip text. Ported from app.js. No DOM/Leaflet here; the map
// layer turns these into a divIcon.

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Client-side fallback when the API predates server-side `visualMode`. */
export function deriveClientRobotVisualMode(health, telemetry) {
  if (health === "emergency") return "emergency";
  if (health === "error") return "error";
  if (!telemetry || typeof telemetry !== "object") return "nav";
  const stateRaw = String(telemetry.stateName ?? "");
  const stateUp = stateRaw.toUpperCase().replace(/\s+/g, "_");
  const docking =
    /(GOING_TO_DOCK|RETURN_TO_DOCK|NAV_TO_DOCK|DOCKING|APPROACH_DOCK|DOCK_NAV|FIND_DOCK|SEARCH_DOCK|TO_DOCK)/i.test(
      stateRaw
    ) && !/UNDOCK/i.test(stateRaw);
  if (docking) return "docking";
  if (telemetry.isCharging === true) return "dock_charging";
  const bat = telemetry.batteryPercent;
  if (
    telemetry.isCharging === false &&
    Number.isFinite(bat) &&
    bat >= 88 &&
    /CHARGING_COMPLETE|DOCKED|AT_DOCK|FULL|STANDBY_DOCK|IDLE_DOCK|PARK_DOCK/i.test(stateUp)
  ) {
    return "dock_full";
  }
  return "nav";
}

export function resolveRobotVisualMode(ros) {
  if (!ros || typeof ros !== "object") return "nav";
  if (ros.visualMode) return ros.visualMode;
  return deriveClientRobotVisualMode(ros.health, ros.telemetry);
}

export function robotVisualToMarkerStyle(visualMode) {
  switch (visualMode) {
    case "emergency":
      return { modifier: "map-marker--robot--emergency", glyph: "emergency_home" };
    case "error":
      return { modifier: "map-marker--robot--error", glyph: "report" };
    case "docking":
      return { modifier: "map-marker--robot--docking", glyph: "ev_station" };
    case "dock_charging":
      return { modifier: "map-marker--robot--dock-charging", glyph: "battery_charging_full" };
    case "dock_full":
      return { modifier: "map-marker--robot--dock-full", glyph: "battery_full" };
    case "nav":
    default:
      return { modifier: "map-marker--robot--nav", glyph: "navigation" };
  }
}

const STATE_LABELS = {
  IDLE: "Idle",
  MOWING: "Mowing",
  DOCKING: "Docking",
  UNDOCKING: "Undocking",
  AREA_RECORDING: "Area recording",
};
const LOW_BATTERY_PERCENT = 20;
const RTK_OK_M = 0.2;
const NO_RTK_FIX_M = 1; // worse than this (incl. the 999 m "no fix" value) reads as no fix

/** The robot's state in plain words ("Mowing", "Docked · charging", ...), or "". */
export function robotStateLabel(telemetry) {
  if (!telemetry || typeof telemetry !== "object") return "";
  if (telemetry.emergency === true) return "Emergency stop";
  const name = String(telemetry.stateName || "").toUpperCase();
  if (name === "IDLE" && telemetry.isCharging === true) return "Docked · charging";
  if (STATE_LABELS[name]) return STATE_LABELS[name];
  if (!name) return telemetry.isCharging === true ? "Charging" : "";
  const words = name.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Position accuracy as "RTK 2 cm" / "no RTK fix", or "" when unknown. */
export function rtkText(positionAccuracy) {
  if (!Number.isFinite(positionAccuracy)) return "";
  if (positionAccuracy > NO_RTK_FIX_M) return "no RTK fix";
  return `RTK ${Math.round(positionAccuracy * 100)} cm`;
}

/**
 * The one thing worth a pill under the robot marker, or null: emergency,
 * low battery, rain, or a missing RTK fix away from the dock.
 */
export function robotAlert(pose) {
  const t = pose?.ros?.telemetry || {};
  if (t.emergency === true) {
    const reason = typeof t.emergencyReason === "string" ? t.emergencyReason.trim().slice(0, 40) : "";
    return { level: "crit", text: reason ? `Emergency stop · ${reason}` : "Emergency stop" };
  }
  if (Number.isFinite(t.batteryPercent) && t.batteryPercent < LOW_BATTERY_PERCENT) {
    return { level: "warn", text: `Battery ${Math.round(t.batteryPercent)}%` };
  }
  if (t.rainDetected === true) return { level: "warn", text: "Rain" };
  const acc = pose?.positionAccuracy;
  if (t.isCharging !== true && Number.isFinite(acc) && acc > RTK_OK_M) return { level: "warn", text: "No RTK fix" };
  return null;
}

/**
 * Hover card for the robot marker: state with a status dot, then battery and
 * RTK, then the alert if any. Depends only on what it shows, so the caller can
 * skip re-rendering while the robot merely moves.
 */
export function robotHoverHtml(pose) {
  const t = pose?.ros?.telemetry || null;
  const alert = robotAlert(pose);
  const level = alert?.level || "ok";
  const meta = [];
  if (Number.isFinite(t?.batteryPercent)) {
    const icon = t.isCharging === true ? "battery_charging_full" : "battery_full";
    meta.push(`<span class="material-symbols-outlined">${icon}</span>${Math.round(t.batteryPercent)}%`);
  }
  const rtk = rtkText(pose?.positionAccuracy);
  if (rtk) meta.push(`<span class="material-symbols-outlined">satellite_alt</span>${escapeHtml(rtk)}`);
  return [
    '<div class="robot-tip">',
    `<div class="robot-tip__head"><span class="robot-tip__dot robot-tip__dot--${level}"></span><span>${escapeHtml(robotStateLabel(t) || "Robot")}</span></div>`,
    meta.length ? `<div class="robot-tip__meta">${meta.join("")}</div>` : "",
    alert ? `<div class="robot-tip__alert robot-tip__alert--${alert.level}">${escapeHtml(alert.text)}</div>` : "",
    "</div>",
  ].join("");
}
