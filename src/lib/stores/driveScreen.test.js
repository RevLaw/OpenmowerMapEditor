// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendControl: vi.fn(() => Promise.resolve({ ok: true })),
  sendTeleop: vi.fn(() => Promise.resolve({ ok: true })),
  stopTeleop: vi.fn(() => Promise.resolve({ ok: true })),
}));

const { sendControl } = await import("../api.js");
const { driveView, editMode, followRobot } = await import("./ui.js");
const { driveMode } = await import("./teleop.js");
const { openDriveScreen, closeDriveScreen } = await import("./driveScreen.js");

describe("drive screen", () => {
  beforeEach(() => {
    sendControl.mockClear();
    driveMode.set("off");
    driveView.set(false);
    editMode.set(true);
    followRobot.set(false);
  });

  it("opens in drive mode, hides editing and follows the robot", async () => {
    expect(await openDriveScreen()).toBe(true);
    expect(sendControl).toHaveBeenCalledWith("record_mode");
    expect(get(driveMode)).toBe("on");
    expect(get(driveView)).toBe(true);
    expect(get(editMode)).toBe(false);
    expect(get(followRobot)).toBe(true);
  });

  it("closes, leaves drive mode and restores edit mode", async () => {
    await openDriveScreen();
    await closeDriveScreen();
    expect(sendControl).toHaveBeenLastCalledWith("record_exit");
    expect(get(driveMode)).toBe("off");
    expect(get(driveView)).toBe(false);
    expect(get(editMode)).toBe(true);
  });

  it("closes again when drive mode can't be entered", async () => {
    sendControl.mockImplementationOnce(() => Promise.resolve({ ok: false, error: "busy" }));
    expect(await openDriveScreen()).toBe(false);
    expect(get(driveView)).toBe(false);
    expect(get(editMode)).toBe(true);
  });
});
