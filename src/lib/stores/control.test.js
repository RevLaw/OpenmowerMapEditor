import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendControl: vi.fn(),
}));

const { sendControl } = await import("../api.js");
const { sendMowerControl, controlSending } = await import("./control.js");
const { status } = await import("./toast.js");

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

describe("sendMowerControl", () => {
  beforeEach(() => sendControl.mockReset());

  // Home can run for a while (Start, wait, Home); a Stop answered meanwhile
  // must not mark the buttons idle while Home is still going.
  it("stays busy until every command in flight has answered", async () => {
    const home = deferred();
    sendControl.mockImplementation((cmd) => (cmd === "home" ? home.promise : Promise.resolve({ ok: true })));
    const homeDone = sendMowerControl("home");
    await sendMowerControl("stop");
    expect(get(controlSending)).toBe(true);
    home.resolve({ ok: true, command: "home" });
    await homeDone;
    expect(get(controlSending)).toBe(false);
  });

  it("shows the server's note instead of the generic message", async () => {
    sendControl.mockResolvedValue({ ok: true, command: "home", note: "Already docked." });
    await sendMowerControl("home");
    expect(get(status)).toBe("Mower: Already docked.");
  });
});
