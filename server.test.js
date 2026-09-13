// Unit tests for server.js's pure/stateless helpers. server.js exports these
// (see the bottom of the file) without binding a port or touching Docker/ROS
// when required this way — see the `require.main === module` guard there.
import { describe, it, expect, beforeEach } from "vitest";

// Set before the first require() below so the module-level consts derived
// from them (wifiCellSizeM, wifiMaxPoints, robotTrailMinDistanceM,
// robotTrailMaxPoints, ...) are deterministic for these tests.
process.env.MAP_PATH = "./ros/__test__map.json";
process.env.PARAMS_PATH = "./params/__test__mower_params.yaml";
process.env.WIFI_MAP_PATH = "./ros/__test__wifi-signal-map.json";
process.env.ROBOT_TRAIL_PATH = "./ros/__test__movement-trail.json";
process.env.OPENMOWER_POSE_DISABLE = "1";
process.env.WIFI_MAP_COLLECTOR_DISABLE = "1";
process.env.ROBOT_TRAIL_COLLECTOR_DISABLE = "1";
process.env.WIFI_MAP_CELL_SIZE_M = "1";
process.env.ROBOT_TRAIL_MIN_DISTANCE_M = "1";

const {
  isDifferentLocalDay,
  classifyTrailPhase,
  normalizeWifiSample,
  wifiCellKey,
  readClampedEnvNumber,
  mergeWifiSurveySample,
  appendRobotTrailPoint,
  wifiSurvey,
  robotTrailHistory,
} = require("./server.js");

describe("isDifferentLocalDay", () => {
  it("is false for two times on the same calendar day", () => {
    const morning = new Date(2026, 5, 10, 9, 0, 0).getTime();
    const afternoon = new Date(2026, 5, 10, 14, 0, 0).getTime();
    expect(isDifferentLocalDay(afternoon, morning)).toBe(false);
  });

  it("is true across a midnight boundary", () => {
    const lateNight = new Date(2026, 5, 10, 23, 59, 0).getTime();
    const earlyNextDay = new Date(2026, 5, 11, 0, 1, 0).getTime();
    expect(isDifferentLocalDay(earlyNextDay, lateNight)).toBe(true);
  });

  it("is true across a month/year boundary", () => {
    const newYearsEve = new Date(2025, 11, 31, 23, 0, 0).getTime();
    const newYearsDay = new Date(2026, 0, 1, 1, 0, 0).getTime();
    expect(isDifferentLocalDay(newYearsDay, newYearsEve)).toBe(true);
  });
});

describe("classifyTrailPhase", () => {
  it("classifies MOWING as mowing", () => {
    expect(classifyTrailPhase("MOWING")).toBe("mowing");
  });

  it("classifies DOCKING and UNDOCKING as docking", () => {
    expect(classifyTrailPhase("DOCKING")).toBe("docking");
    expect(classifyTrailPhase("UNDOCKING")).toBe("docking");
  });

  it("is case-insensitive", () => {
    expect(classifyTrailPhase("mowing")).toBe("mowing");
  });

  it("falls back to null for unrelated or missing states", () => {
    expect(classifyTrailPhase("IDLE")).toBe(null);
    expect(classifyTrailPhase(undefined)).toBe(null);
    expect(classifyTrailPhase("")).toBe(null);
  });
});

describe("readClampedEnvNumber", () => {
  const opts = { min: 10, max: 100, fallback: 50 };

  it("returns the fallback when unset", () => {
    delete process.env.__TEST_NUM__;
    expect(readClampedEnvNumber("__TEST_NUM__", opts)).toBe(50);
  });

  it("returns the parsed value when in range", () => {
    process.env.__TEST_NUM__ = "42";
    expect(readClampedEnvNumber("__TEST_NUM__", opts)).toBe(42);
    delete process.env.__TEST_NUM__;
  });

  it("clamps a value below the minimum", () => {
    process.env.__TEST_NUM__ = "1";
    expect(readClampedEnvNumber("__TEST_NUM__", opts)).toBe(10);
    delete process.env.__TEST_NUM__;
  });

  it("clamps a value above the maximum", () => {
    process.env.__TEST_NUM__ = "9999";
    expect(readClampedEnvNumber("__TEST_NUM__", opts)).toBe(100);
    delete process.env.__TEST_NUM__;
  });

  it("falls back on a non-numeric value", () => {
    process.env.__TEST_NUM__ = "not-a-number";
    expect(readClampedEnvNumber("__TEST_NUM__", opts)).toBe(50);
    delete process.env.__TEST_NUM__;
  });

  it("floors to an integer when integer: true", () => {
    process.env.__TEST_NUM__ = "42.9";
    expect(readClampedEnvNumber("__TEST_NUM__", { ...opts, integer: true })).toBe(42);
    delete process.env.__TEST_NUM__;
  });
});

describe("normalizeWifiSample / wifiCellKey", () => {
  it("quantizes a valid sample onto the configured cell grid", () => {
    const result = normalizeWifiSample({ x: 1.2, y: 2.4, signalDbm: -60 });
    expect(result).not.toBe(null);
    expect(result.x).toBe(Math.round(1.2 / 1) * 1); // WIFI_MAP_CELL_SIZE_M=1 in this file
    expect(result.y).toBe(Math.round(2.4 / 1) * 1);
    expect(result.signalDbm).toBe(-60);
    expect(result.key).toBe(wifiCellKey(1.2, 2.4));
  });

  it("rejects a sample with a non-finite coordinate", () => {
    expect(normalizeWifiSample({ x: NaN, y: 1, signalDbm: -60 })).toBe(null);
  });

  it("rejects a signal strength outside the plausible dBm range", () => {
    expect(normalizeWifiSample({ x: 1, y: 1, signalDbm: 10 })).toBe(null);
    expect(normalizeWifiSample({ x: 1, y: 1, signalDbm: -200 })).toBe(null);
  });

  it("rejects a coordinate far outside any plausible map", () => {
    expect(normalizeWifiSample({ x: 200000, y: 1, signalDbm: -60 })).toBe(null);
  });
});

describe("mergeWifiSurveySample", () => {
  beforeEach(() => {
    wifiSurvey.clear();
  });

  it("stores a brand-new cell with a sample count of 1", () => {
    expect(mergeWifiSurveySample({ x: 5, y: 5, signalDbm: -50 }, false)).toBe(true);
    const entry = wifiSurvey.get(wifiCellKey(5, 5));
    expect(entry).toMatchObject({ signalDbm: -50, samples: 1 });
  });

  it("weighted-averages a second reading into the same cell instead of overwriting it", () => {
    mergeWifiSurveySample({ x: 5, y: 5, signalDbm: -50 }, false);
    mergeWifiSurveySample({ x: 5, y: 5, signalDbm: -60 }, false);
    const entry = wifiSurvey.get(wifiCellKey(5, 5));
    // weight=1 on the first reading: (-50*1 + -60) / 2 = -55
    expect(entry.signalDbm).toBe(-55);
    expect(entry.samples).toBe(2);
  });

  it("returns false and leaves the survey untouched for an invalid sample", () => {
    expect(mergeWifiSurveySample({ x: 1, y: 1, signalDbm: 999 }, false)).toBe(false);
    expect(wifiSurvey.size).toBe(0);
  });
});

describe("appendRobotTrailPoint", () => {
  beforeEach(() => {
    robotTrailHistory.length = 0;
  });

  it("always appends the first point regardless of distance", () => {
    expect(appendRobotTrailPoint(0, 0, 1000, false)).toBe(true);
    expect(robotTrailHistory).toEqual([{ x: 0, y: 0, t: 1000 }]);
  });

  it("rejects a point that hasn't moved far enough (ROBOT_TRAIL_MIN_DISTANCE_M=1 here)", () => {
    appendRobotTrailPoint(0, 0, 1000, false);
    expect(appendRobotTrailPoint(0.2, 0, 1001, false)).toBe(false);
    expect(robotTrailHistory).toHaveLength(1);
  });

  it("accepts a point once it has moved past the minimum distance", () => {
    appendRobotTrailPoint(0, 0, 1000, false);
    expect(appendRobotTrailPoint(5, 0, 1001, false)).toBe(true);
    expect(robotTrailHistory).toHaveLength(2);
  });

  it("attaches a phase only when one is given", () => {
    appendRobotTrailPoint(0, 0, 1000, false, "mowing");
    expect(robotTrailHistory[0].phase).toBe("mowing");
  });

  it("rejects a non-finite or out-of-range coordinate", () => {
    expect(appendRobotTrailPoint(NaN, 0, 1000, false)).toBe(false);
    expect(appendRobotTrailPoint(200000, 0, 1000, false)).toBe(false);
    expect(robotTrailHistory).toHaveLength(0);
  });
});
