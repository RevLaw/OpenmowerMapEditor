// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendTeleop: vi.fn(() => Promise.resolve({ ok: true })),
  stopTeleop: vi.fn(() => Promise.resolve({ ok: true })),
  sendControl: vi.fn(() => Promise.resolve({ ok: true })),
}));

const { sendTeleop } = await import("../api.js");
const { loadMap } = await import("./editor.js");
const { robotPose } = await import("./robot.js");
const { driveMode, setStick, initTeleopSafety } = await import("./teleop.js");
const { gotoState, armGoto, cancelGoto, pickTarget, startGoto, gotoBlocker } = await import("./goto.js");

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function pose(x, y, yaw = 0, extra = {}) {
  robotPose.set({
    ok: true,
    x,
    y,
    yaw,
    positionAccuracy: 0.02,
    source: "stream",
    ros: { telemetry: { stateName: "AREA_RECORDING" } },
    ...extra,
  });
}

const lastCall = () => sendTeleop.mock.calls[sendTeleop.mock.calls.length - 1];

async function driveTo(target) {
  armGoto();
  pickTarget(target);
  startGoto();
  await vi.advanceTimersByTimeAsync(0);
}

describe("go-to store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadMap(JSON.stringify({ areas: [{ id: "a1", properties: { type: "mow" }, outline: rect(0, 0, 20, 10) }] }));
    driveMode.set("on");
    pose(2, 5);
    sendTeleop.mockClear();
    sendTeleop.mockImplementation(() => Promise.resolve({ ok: true }));
  });

  afterEach(() => {
    cancelGoto();
    driveMode.set("off");
    vi.useRealTimers();
  });

  it("needs drive mode", () => {
    driveMode.set("off");
    expect(gotoBlocker()).toMatch(/drive mode/i);
    driveMode.set("on");
    armGoto();
    expect(get(gotoState).phase).toBe("picking");
    pickTarget({ x: 15, y: 5 });
    expect(get(gotoState).phase).toBe("planned");
  });

  it("needs an accurate, streamed pose from a robot in recording mode", () => {
    pose(2, 5, 0, { positionAccuracy: 0.5 });
    expect(gotoBlocker()).toMatch(/accura/i);
    pose(2, 5, 0, { source: "probe" });
    expect(gotoBlocker()).toMatch(/stream/i);
    pose(2, 5, 0, { ros: { telemetry: { stateName: "IDLE" } } });
    expect(gotoBlocker()).toMatch(/accept/i);
  });

  it("shows a reason when the target can't be reached", () => {
    armGoto();
    pickTarget({ x: 40, y: 5 });
    expect(get(gotoState).phase).toBe("picking");
    expect(get(gotoState).reason).toMatch(/outside/i);
  });

  it("drives to the target and sends zero on arrival", async () => {
    await driveTo({ x: 15, y: 5 });
    expect(get(gotoState).phase).toBe("driving");
    expect(lastCall()[0]).toBeGreaterThan(0);
    pose(14.9, 5);
    await vi.advanceTimersByTimeAsync(100);
    expect(get(gotoState).phase).toBe("arrived");
    expect(lastCall()).toEqual([0, 0]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(get(gotoState).phase).toBe("idle");
  });

  it("re-plans from the current position when Go is pressed", () => {
    armGoto();
    pickTarget({ x: 15, y: 5 });
    pose(4, 5);
    startGoto();
    expect(get(gotoState).start).toEqual({ x: 4, y: 5 });
  });

  it("stops when the pose goes stale", async () => {
    await driveTo({ x: 15, y: 5 });
    await vi.advanceTimersByTimeAsync(1200);
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/position/i);
    expect(lastCall()).toEqual([0, 0]);
  });

  it("stops when RTK accuracy drops", async () => {
    await driveTo({ x: 15, y: 5 });
    pose(3, 5, 0, { positionAccuracy: 0.4 });
    await vi.advanceTimersByTimeAsync(100);
    expect(get(gotoState).phase).toBe("stopped");
  });

  it("stops when the robot leaves the route", async () => {
    await driveTo({ x: 15, y: 5 });
    pose(5, 6);
    await vi.advanceTimersByTimeAsync(100);
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/route/i);
  });

  it("stops before drifting as far as the clearance margin", async () => {
    await driveTo({ x: 15, y: 5 });
    pose(5, 5.3);
    await vi.advanceTimersByTimeAsync(100);
    expect(get(gotoState).phase).toBe("stopped");
  });

  it("gives way to the joystick", async () => {
    await driveTo({ x: 15, y: 5 });
    setStick(0, 0.8);
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/joystick/i);
    setStick(0, 0);
  });

  it("won't start while the joystick is held", async () => {
    armGoto();
    pickTarget({ x: 15, y: 5 });
    setStick(0, 0.8);
    sendTeleop.mockClear();
    startGoto();
    await vi.advanceTimersByTimeAsync(300);
    expect(get(gotoState).phase).toBe("planned");
    expect(get(gotoState).reason).toMatch(/joystick/i);
    // Only the stick's own loop sent commands (forward, no turn from a go-to).
    expect(sendTeleop.mock.calls.every(([, az]) => az === 0)).toBe(true);
    setStick(0, 0);
  });

  it("stops when the window loses focus", async () => {
    const cleanup = initTeleopSafety();
    await driveTo({ x: 15, y: 5 });
    window.dispatchEvent(new Event("blur"));
    expect(get(gotoState).phase).toBe("stopped");
    cleanup();
  });

  it("stops when drive mode ends", async () => {
    await driveTo({ x: 15, y: 5 });
    driveMode.set("off");
    expect(get(gotoState).phase).toBe("stopped");
  });

  it("stops when the server rejects a command", async () => {
    sendTeleop.mockImplementation(() => Promise.resolve({ ok: false, error: "nope\n" }));
    await driveTo({ x: 15, y: 5 });
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toBe("server: nope.");
  });

  it("stops when the server stops answering, and the next go-to still sends", async () => {
    sendTeleop.mockImplementation(() => new Promise(() => {}));
    await driveTo({ x: 15, y: 5 });
    for (let t = 0; t < 12; t += 1) {
      pose(2 + t * 0.02, 5);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(get(gotoState).phase).toBe("stopped");
    expect(get(gotoState).reason).toMatch(/respond/i);

    sendTeleop.mockImplementation(() => Promise.resolve({ ok: true }));
    sendTeleop.mockClear();
    await driveTo({ x: 15, y: 5 });
    expect(sendTeleop.mock.calls.some(([lx]) => lx > 0)).toBe(true);
  });
});
