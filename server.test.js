// Unit tests for server.js's pure/stateless helpers. server.js exports these
// (see the bottom of the file) without binding a port or touching Docker/ROS
// when required this way — see the `require.main === module` guard there.
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  CONTROL_PY,
  clampTeleopCommand,
  sensorFrameToSensor,
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

describe("sensorFrameToSensor", () => {
  const frame = {
    t: "N",
    id: "om_v_battery",
    name: "V Battery",
    unit: "V",
    desc: 4,
    v: 28.87,
    lo: 24,
    hi: 27,
    clo: 23,
    chi: 29,
  };

  it("turns a streamed xbot_monitoring sensor into the UI shape", () => {
    expect(sensorFrameToSensor(frame)).toEqual({
      id: "om_v_battery",
      name: "V Battery",
      unit: "V",
      kind: "voltage",
      value: 28.87,
      min: 24,
      max: 27,
      critLow: 23,
      critHigh: 29,
    });
  });

  it("keeps text values and leaves missing limits empty", () => {
    const s = sensorFrameToSensor({ t: "N", id: "om_charge_state", name: "Charge State", unit: "", desc: 0, v: "N/A" });
    expect(s).toMatchObject({ id: "om_charge_state", value: "N/A", kind: null, min: null, max: null });
  });

  it("rejects malformed frames", () => {
    expect(sensorFrameToSensor({ ...frame, id: "" })).toBeNull();
    expect(sensorFrameToSensor({ ...frame, id: "bad id;rm" })).toBeNull();
    expect(sensorFrameToSensor({ ...frame, v: Number.NaN })).toBeNull();
    expect(sensorFrameToSensor({ ...frame, v: { x: 1 } })).toBeNull();
    expect(sensorFrameToSensor(null)).toBeNull();
  });

  it("caps long text", () => {
    const s = sensorFrameToSensor({ ...frame, name: "x".repeat(500), v: "y".repeat(500) });
    expect(s.name.length).toBeLessThanOrEqual(60);
    expect(s.value.length).toBeLessThanOrEqual(60);
  });
});

describe("clampTeleopCommand", () => {
  it("passes valid commands through", () => {
    expect(clampTeleopCommand({ lx: 0.2, az: -0.5 })).toEqual({ lx: 0.2, az: -0.5 });
  });

  it("clamps to the max linear / angular speed", () => {
    // Forward cap = OpenMower's turbo speed (the drive screen's sprint bubble).
    expect(clampTeleopCommand({ lx: 5, az: -9 })).toEqual({ lx: 1, az: -1.5 });
    expect(clampTeleopCommand({ lx: 0.9, az: 0 })).toEqual({ lx: 0.9, az: 0 });
  });

  it("rejects missing or non-numeric values", () => {
    expect(clampTeleopCommand({ lx: "fast", az: 0 })).toBeNull();
    expect(clampTeleopCommand({ lx: 0.1 })).toBeNull();
    expect(clampTeleopCommand(null)).toBeNull();
    expect(clampTeleopCommand({ lx: Infinity, az: 0 })).toBeNull();
  });
});

// CONTROL_PY runs inside the ROS container; here it runs under plain Python
// against stub rospy/mower_msgs modules. The stub simulates mower_logic's state
// changes (scenario.on["STATE:event"] -> next state name, or fields to set) on a virtual clock, so the
// waits and retries finish instantly, and logs every command it receives.
const ROS_STUB = String.raw`
import json, os, time
_clock = [1000.0]
def _sleep(s):
    _clock[0] += s
time.time = lambda: _clock[0]
time.sleep = _sleep
SC = json.loads(os.environ["SIM"])
state = {"emergency": False, "is_charging": False}
state.update(SC["state"])

class ROSException(Exception):
    pass

def _record(entry):
    with open(os.environ["SIM_LOG"], "a") as f:
        f.write(json.dumps(entry) + "\n")

def _apply(event):
    nxt = SC.get("on", {}).get(state["state_name"] + ":" + event)
    if isinstance(nxt, dict):
        state.update(nxt)
    elif nxt:
        state["state_name"] = nxt

def init_node(*a, **k):
    pass

def wait_for_service(*a, **k):
    pass

class ServiceProxy:
    def __init__(self, name, cls):
        self.name = name
    def __call__(self, req):
        if "emergency" in self.name:
            _record("emergency")
            state["emergency"] = True
        else:
            _record(req.command)
            _apply(str(req.command))

class _Status:
    def __init__(self, d):
        self.__dict__.update(d)

def wait_for_message(topic, cls, timeout=None):
    _clock[0] += 0.1
    return _Status(dict(state))

class Publisher:
    def __init__(self, *a, **k):
        pass
    def get_num_connections(self):
        return 1
    def publish(self, msg):
        _record(msg.data)
        _apply("exit")
`;
const STUB_MODULES = {
  "rospy.py": ROS_STUB,
  "mower_msgs/__init__.py": "",
  "mower_msgs/msg.py": "class HighLevelStatus:\n    pass\n",
  "mower_msgs/srv.py": [
    "class HighLevelControlSrv: pass",
    "class EmergencyStopSrv: pass",
    "class HighLevelControlSrvRequest:\n    command = 0",
    "class EmergencyStopSrvRequest:\n    emergency = 0",
  ].join("\n"),
  "std_msgs/__init__.py": "",
  "std_msgs/msg.py": "class String:\n    def __init__(self, data=''):\n        self.data = data\n",
};
const hasPython = spawnSync("python3", ["--version"]).status === 0;

function runControl(cmd, scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-control-"));
  try {
    for (const [file, src] of Object.entries(STUB_MODULES)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), src);
    }
    fs.writeFileSync(path.join(dir, "control.py"), CONTROL_PY);
    const log = path.join(dir, "calls.log");
    const run = spawnSync("python3", [path.join(dir, "control.py")], {
      env: { ...process.env, PYTHONPATH: dir, OM_CMD: cmd, SIM: JSON.stringify(scenario), SIM_LOG: log },
      encoding: "utf8",
      timeout: 10000,
    });
    const line = run.stdout.trim().split("\n").pop();
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    return { result: JSON.parse(line), calls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const START = 1;
const HOME = 2;
const EXIT_RECORDING = "mower_logic:area_recording/exit_recording_mode";

describe.skipIf(!hasPython)("control: Home", () => {
  it("off the dock and idle: starts, then sends Home as soon as it's mowing", () => {
    const { result, calls } = runControl("home", {
      state: { state_name: "IDLE" },
      on: { "IDLE:1": "MOWING", "MOWING:2": "DOCKING" },
    });
    expect(calls).toEqual([START, HOME]);
    expect(result).toEqual({ ok: true, command: "home", via: "start", state: "DOCKING" });
  });

  it("does nothing when the robot is already docked", () => {
    const { result, calls } = runControl("home", { state: { state_name: "IDLE", is_charging: true } });
    expect(calls).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.note).toBe("Already docked.");
  });

  it("while mowing: sends just Home", () => {
    const { result, calls } = runControl("home", { state: { state_name: "MOWING" }, on: { "MOWING:2": "DOCKING" } });
    expect(calls).toEqual([HOME]);
    expect(result).toEqual({ ok: true, command: "home" });
  });

  it("in drive mode: leaves area recording first, then goes home", () => {
    const { result, calls } = runControl("home", {
      state: { state_name: "AREA_RECORDING" },
      on: { "AREA_RECORDING:exit": "IDLE", "IDLE:1": "MOWING", "MOWING:2": "DOCKING" },
    });
    expect(calls).toEqual([EXIT_RECORDING, START, HOME]);
    expect(result.ok).toBe(true);
  });

  it("is done after Start when OpenMower heads for the dock by itself", () => {
    const { result, calls } = runControl("home", { state: { state_name: "IDLE" }, on: { "IDLE:1": "DOCKING" } });
    expect(calls).toEqual([START]);
    expect(result).toMatchObject({ ok: true, state: "DOCKING" });
  });

  it("emergency-stops instead of leaving the robot mowing when Home isn't taken", () => {
    const { result, calls } = runControl("home", { state: { state_name: "IDLE" }, on: { "IDLE:1": "MOWING" } });
    expect(calls).toEqual([START, HOME, HOME, HOME, HOME, "emergency"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/emergency stop/);
  });

  it("emergency-stops when Start gets no reaction, so it can't fire later", () => {
    const { result, calls } = runControl("home", { state: { state_name: "IDLE" } });
    expect(calls).toEqual([START, "emergency"]);
    expect(result.ok).toBe(false);
  });

  it("stops the sequence when STOP is pressed while it runs", () => {
    const { result, calls } = runControl("home", {
      state: { state_name: "IDLE" },
      on: { "IDLE:1": { state_name: "MOWING", emergency: true } },
    });
    expect(calls).toEqual([START]);
    expect(result).toEqual({ ok: false, error: "Emergency stop is active — reset it first." });
  });

  it("refuses while the emergency stop is active", () => {
    const { result, calls } = runControl("home", { state: { state_name: "IDLE", emergency: true } });
    expect(calls).toEqual([]);
    expect(result).toEqual({ ok: false, error: "Emergency stop is active — reset it first." });
  });
});

describe.skipIf(!hasPython)("control: other commands", () => {
  it("passes Start straight through", () => {
    const { result, calls } = runControl("start", { state: { state_name: "IDLE" } });
    expect(calls).toEqual([START]);
    expect(result).toEqual({ ok: true, command: "start" });
  });

  it("Stop is an emergency stop", () => {
    const { calls } = runControl("stop", { state: { state_name: "MOWING" } });
    expect(calls).toEqual(["emergency"]);
  });
});
