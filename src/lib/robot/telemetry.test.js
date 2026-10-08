import { describe, it, expect } from "vitest";
import { robotStateLabel, rtkText, robotAlert, robotHoverHtml } from "./telemetry.js";

const pose = (telemetry, positionAccuracy = 0.02) => ({ ok: true, positionAccuracy, ros: { telemetry } });

describe("robotStateLabel", () => {
  it("names the robot's state in plain words", () => {
    expect(robotStateLabel({ stateName: "MOWING" })).toBe("Mowing");
    expect(robotStateLabel({ stateName: "AREA_RECORDING" })).toBe("Area recording");
    expect(robotStateLabel({ stateName: "IDLE", isCharging: true })).toBe("Docked · charging");
    expect(robotStateLabel({ stateName: "IDLE" })).toBe("Idle");
    expect(robotStateLabel({ stateName: "MOWING", emergency: true })).toBe("Emergency stop");
    expect(robotStateLabel(null)).toBe("");
  });
});

describe("rtkText", () => {
  it("shows the position accuracy", () => {
    expect(rtkText(0.021)).toBe("RTK 2 cm");
    expect(rtkText(0.35)).toBe("RTK 35 cm");
    expect(rtkText(999)).toBe("no RTK fix");
    expect(rtkText(null)).toBe("");
  });
});

describe("robotAlert", () => {
  it("is quiet when all is well", () => {
    expect(robotAlert(pose({ stateName: "MOWING", batteryPercent: 80 }))).toBeNull();
  });

  it("raises the most important problem only", () => {
    expect(robotAlert(pose({ emergency: true, batteryPercent: 10 }, 999))).toEqual({ level: "crit", text: "Emergency stop" });
    expect(robotAlert(pose({ batteryPercent: 15 }, 999))).toEqual({ level: "warn", text: "Battery 15%" });
    expect(robotAlert(pose({ batteryPercent: 80, rainDetected: true }))).toEqual({ level: "warn", text: "Rain" });
    expect(robotAlert(pose({ batteryPercent: 80 }, 0.6))).toEqual({ level: "warn", text: "No RTK fix" });
  });

  it("doesn't call a docked robot's missing RTK a problem", () => {
    expect(robotAlert(pose({ batteryPercent: 80, isCharging: true }, 999))).toBeNull();
  });

  it("doesn't guess when the accuracy is unknown", () => {
    expect(robotAlert(pose({ batteryPercent: 80 }, null))).toBeNull();
  });
});

describe("robotHoverHtml", () => {
  it("is a small card: state with a status dot, then battery and RTK", () => {
    const html = robotHoverHtml(pose({ stateName: "MOWING", batteryPercent: 84 }));
    expect(html).toContain("robot-tip__dot--ok");
    expect(html).toContain(">Mowing<");
    expect(html).toContain("84%");
    expect(html).toContain("RTK 2 cm");
    expect(html).not.toContain("robot-tip__alert");
  });

  it("adds the alert, coloured by how serious it is", () => {
    const html = robotHoverHtml(pose({ stateName: "MOWING", emergency: true }));
    expect(html).toContain("robot-tip__dot--crit");
    expect(html).toContain("robot-tip__alert--crit");
  });

  it("is stable for the same state, so it isn't rebuilt on every pose", () => {
    const a = robotHoverHtml(pose({ stateName: "MOWING", batteryPercent: 84 }));
    const b = robotHoverHtml({ ...pose({ stateName: "MOWING", batteryPercent: 84 }), x: 5, y: 7, yaw: 1 });
    expect(a).toBe(b);
  });

  it("escapes text from the robot", () => {
    expect(robotHoverHtml(pose({ stateName: "<b>X</b>" }))).not.toContain("<b>X</b>");
  });
});
