import { describe, it, expect } from "vitest";
import { sensorLevel, formatSensorValue, sensorGroups } from "./sensors.js";

const sensor = (over) => ({
  id: "om_v_battery",
  name: "V Battery",
  unit: "V",
  kind: "voltage",
  value: 26.5,
  min: 24,
  max: 27,
  critLow: 23,
  critHigh: 29,
  ...over,
});

describe("sensorLevel", () => {
  it("is ok inside the critical limits — the min/max range is only a display range", () => {
    expect(sensorLevel(sensor({ value: 28.9 }))).toBe("ok");
    expect(sensorLevel(sensor({ id: "om_mow_motor_temp", kind: "temperature", value: 8.8, min: 40, max: 70, critLow: null, critHigh: null }))).toBe("ok");
  });

  it("is critical beyond a critical limit", () => {
    expect(sensorLevel(sensor({ value: 29.5 }))).toBe("crit");
    expect(sensorLevel(sensor({ value: 22 }))).toBe("crit");
  });

  it("doesn't flag an idle reading of 0 against a critical-low (blade off)", () => {
    expect(sensorLevel(sensor({ id: "om_mow_motor_rpm", kind: "rpm", value: 0, critLow: 2300, critHigh: null }))).toBe("ok");
    expect(sensorLevel(sensor({ id: "om_mow_motor_rpm", kind: "rpm", value: 1500, critLow: 2300, critHigh: null }))).toBe("crit");
  });

  it("is ok for text values", () => {
    expect(sensorLevel(sensor({ value: "N/A", kind: null }))).toBe("ok");
  });
});

describe("formatSensorValue", () => {
  it("formats by kind", () => {
    expect(formatSensorValue(sensor({ value: 28.882 }))).toBe("28.88 V");
    expect(formatSensorValue(sensor({ kind: "temperature", unit: "deg.C", value: 32.14 }))).toBe("32.1 °C");
    expect(formatSensorValue(sensor({ kind: "current", unit: "A", value: 1.234 }))).toBe("1.23 A");
    expect(formatSensorValue(sensor({ kind: "rpm", unit: "rpm", value: 3123.6 }))).toBe("3124 rpm");
    expect(formatSensorValue(sensor({ kind: null, unit: "", value: "N/A" }))).toBe("N/A");
  });

  it("shows GPS accuracy in cm, and 'no fix' for the 999 m placeholder", () => {
    const gps = { id: "om_gps_accuracy", kind: "distance", unit: "m" };
    expect(formatSensorValue(sensor({ ...gps, value: 0.021 }))).toBe("2 cm");
    expect(formatSensorValue(sensor({ ...gps, value: 1.5 }))).toBe("1.50 m");
    expect(formatSensorValue(sensor({ ...gps, value: 999 }))).toBe("no fix");
  });
});

describe("sensorGroups", () => {
  const sensors = [
    sensor(),
    sensor({ id: "om_v_charge", name: "V Charge", value: 29.3, critHigh: 30 }),
    sensor({ id: "om_charge_state", name: "Charge State", kind: null, unit: "", value: "N/A" }),
    sensor({ id: "om_gps_accuracy", name: "GPS Accuracy", kind: "distance", unit: "m", value: 0.02 }),
    sensor({ id: "om_left_esc_temp", name: "Left ESC Temp", kind: "temperature", unit: "deg.C", value: 32.1 }),
    sensor({ id: "om_mow_motor_rpm", name: "Mow Motor Revolutions", kind: "rpm", unit: "rpm", value: 0 }),
    sensor({ id: "om_mystery", name: "Mystery", kind: null, unit: "x", value: 3 }),
  ];
  const telemetry = { batteryPercent: 84, gpsQualityPercent: 100, isCharging: true, emergency: false, rainDetected: true };

  it("groups sensors and robot-state values by what they are about", () => {
    const groups = sensorGroups(sensors, telemetry);
    expect(groups.map((g) => g.title)).toEqual(["Power", "Position", "Motors", "Safety", "Other"]);
    const rows = (title) => groups.find((g) => g.title === title).rows.map((r) => r.label);
    expect(rows("Power")).toEqual(["Battery", "Charging", "V Battery", "V Charge", "Charge State"]);
    expect(rows("Position")).toEqual(["GPS quality", "GPS Accuracy"]);
    expect(rows("Motors")).toEqual(["Left ESC Temp", "Mow Motor Revolutions"]);
    expect(rows("Safety")).toEqual(["Emergency", "Rain"]);
    expect(rows("Other")).toEqual(["Mystery"]);
  });

  it("flags emergency and rain", () => {
    const safety = sensorGroups([], { emergency: true, rainDetected: true }).find((g) => g.title === "Safety").rows;
    expect(safety).toEqual([
      { label: "Emergency", value: "STOP", level: "crit" },
      { label: "Rain", value: "yes", level: "warn" },
    ]);
  });

  it("leaves out empty groups", () => {
    expect(sensorGroups([], null)).toEqual([]);
  });
});
