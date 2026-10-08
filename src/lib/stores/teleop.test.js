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
const { driveMode, driveSpeed, driveCommand, setStick } = await import("./teleop.js");

describe("stick sprint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    driveMode.set("on");
    driveSpeed.set(0.2);
    sendTeleop.mockClear();
  });

  afterEach(() => {
    setStick(0, 0);
    driveMode.set("off");
    vi.useRealTimers();
  });

  it("sends the turbo speed while the thumb is in the sprint bubble", () => {
    setStick(0, 1, true);
    expect(sendTeleop).toHaveBeenLastCalledWith(1, 0);
    expect(get(driveCommand)).toMatchObject({ lx: 1, turbo: true });
  });

  it("goes back to the slider speed outside the bubble within one tick", async () => {
    setStick(0, 1, true);
    setStick(0, 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(get(driveCommand)).toMatchObject({ lx: 0.1, turbo: false });
  });
});
