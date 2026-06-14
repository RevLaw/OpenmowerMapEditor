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

/** Multiline HUD label: power/GPS, mode, extras (mow, temps, emergency). */
export function buildRobotHudLines(telemetry) {
  if (!telemetry || typeof telemetry !== "object") return [];
  const lines = [];
  const power = [];
  if (Number.isFinite(telemetry.batteryPercent)) {
    power.push(`Batt ${Math.round(telemetry.batteryPercent)}%`);
  }
  if (Number.isFinite(telemetry.gpsQualityPercent)) {
    power.push(`GPS ${Math.round(telemetry.gpsQualityPercent)}%`);
  }
  if (telemetry.isCharging === true) power.push("charging");
  if (power.length) lines.push(power.join(" · "));

  const mode = [];
  if (typeof telemetry.stateName === "string" && telemetry.stateName.trim()) {
    mode.push(telemetry.stateName.replace(/_/g, " "));
  }
  if (typeof telemetry.subStateName === "string" && telemetry.subStateName.trim()) {
    mode.push(telemetry.subStateName.replace(/_/g, " "));
  }
  if (mode.length) lines.push(mode.join(" · "));

  const extra = [];
  if (telemetry.mowEnabled === true) extra.push("mow on");
  else if (telemetry.mowEnabled === false) extra.push("mow off");
  if (telemetry.rainDetected === true) extra.push("rain");
  if (Number.isFinite(telemetry.escTempC)) extra.push(`ESC ${Math.round(telemetry.escTempC)}°C`);
  if (Number.isFinite(telemetry.mowerMotorRpm)) {
    extra.push(`${Math.round(telemetry.mowerMotorRpm)} RPM`);
  }
  if (telemetry.emergency === true) extra.push("emergency");
  if (telemetry.activeEmergency === true) extra.push("estop active");
  if (telemetry.latchedEmergency === true) extra.push("latched");
  if (typeof telemetry.emergencyReason === "string" && telemetry.emergencyReason.trim()) {
    extra.push(telemetry.emergencyReason.trim().slice(0, 40));
  }
  if (extra.length) lines.push(extra.join(" · "));

  return lines;
}

export function buildRobotHudHtml(telemetry) {
  const lines = buildRobotHudLines(telemetry);
  if (!lines.length) return "";
  return lines
    .map((line) => `<div class="robot-marker-hud__line">${escapeHtml(line)}</div>`)
    .join("");
}

function appendRobotTelemetryTooltipBrief(lines, telemetry) {
  if (!telemetry || typeof telemetry !== "object") return;
  if (Number.isFinite(telemetry.batteryPercent)) {
    lines.push(`Battery ${Math.round(telemetry.batteryPercent)}%`);
  }
  if (Number.isFinite(telemetry.gpsQualityPercent)) {
    lines.push(`GPS ${Math.round(telemetry.gpsQualityPercent)}%`);
  }
  if (telemetry.isCharging === true) lines.push("Power: charging");
  if (telemetry.stateName) lines.push(`Mode: ${telemetry.stateName}`);
}

export function buildRobotPoseTooltip(data) {
  const lines = [
    `Robot (${data.frameParent}→${data.frameChild})  x=${data.x.toFixed(2)}m y=${data.y.toFixed(2)}m`,
  ];
  const c = data.container;
  if (c && typeof c === "object") {
    if (c.exists === false) {
      lines.push("Container: not found");
    } else if (c.exists == null) {
      lines.push(`Container: unavailable (${c.status || "?"})`);
    } else if (!c.running || (Number.isFinite(c.restartCount) && c.restartCount > 0)) {
      lines.push(`Container: ${c.running ? "running" : "stopped"} (${c.status || "?"})`);
      if (Number.isFinite(c.restartCount) && c.restartCount > 0) {
        lines.push(`Restarts: ${c.restartCount}`);
      }
    }
  }
  if (data.ros && data.ros.telemetry) {
    appendRobotTelemetryTooltipBrief(lines, data.ros.telemetry);
  }
  if (data.ros) {
    if (data.ros.summary) lines.push(`Status: ${data.ros.summary}`);
    if (data.ros.topic) lines.push(`ROS sample: ${data.ros.topic}`);
  }
  return lines.join("\n");
}
