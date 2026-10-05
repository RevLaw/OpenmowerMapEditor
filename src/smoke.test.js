// @vitest-environment happy-dom
// Runtime smoke test: confirm Svelte 5 mounts every component (stores, reactive
// statements, transitions) without throwing — e.g. the `effect_orphan` error
// that a production build can't catch. Modals are also mounted open so their
// full template renders.
import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";

const modules = import.meta.glob("./components/**/*.svelte", { eager: true });

const noop = () => {};
// Required props (no default) and non-default states worth rendering.
const PROPS = {
  CaptureToggleHeader: [{ icon: "wifi", label: "WiFi", enabled: true, toggleTitle: "Toggle", onToggle: noop }],
  OverlayToggleRow: [
    { label: "Trail", enabled: true, toggleTitle: "Toggle", onToggle: noop, clearTitle: "Clear", onClear: noop },
  ],
  BackupsModal: [{}, { open: true }],
  CommandPalette: [{}, { open: true }],
  ShortcutCheatSheet: [{}, { open: true }],
  Collapsible: [{ title: "Section" }, { title: "Section", open: false, key: "smoke" }],
  MiniMap: [{ map: null }],
};

function mountInto(Component, props) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(Component, { target, props });
  flushSync();
  return {
    target,
    destroy() {
      unmount(instance);
      target.remove();
    },
  };
}

function mountOk(Component, props) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(Component, { target, props });
  flushSync();
  unmount(instance);
  target.remove();
}

describe("Svelte 5 mount smoke", () => {
  // Network calls made on mount (backups list, map load, …) are irrelevant here.
  globalThis.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));

  for (const [file, mod] of Object.entries(modules)) {
    const name = file.split("/").pop().replace(".svelte", "");
    for (const [i, props] of (PROPS[name] || [{}]).entries()) {
      it(`mounts ${name}${i ? ` (variant ${i})` : ""} without error`, () => {
        expect(() => mountOk(mod.default, props)).not.toThrow();
      });
    }
  }
});

// The editor store mutates zones in place and re-emits the same object
// references. Panels must still re-render on those edits (a `$derived` alias of
// a store object compares by identity and would silently go stale).
describe("panels follow in-place editor mutations", () => {
  const square = (x, y, s) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  const MAP = JSON.stringify({
    areas: [
      { id: "a1", properties: { type: "mow", name: "front" }, outline: square(0, 0, 10) },
      { id: "a2", properties: { type: "obstacle" }, outline: square(2, 2, 1) },
    ],
  });

  async function load() {
    const { loadMap } = await import("./lib/stores/editor.js");
    loadMap(MAP);
    flushSync();
  }

  it("Zone editor shows a renamed zone", async () => {
    await load();
    const { renameCurrentZone } = await import("./lib/actions.js");
    const ZoneEditor = modules["./components/ZoneEditor.svelte"].default;
    const view = mountInto(ZoneEditor);
    const nameInput = () => view.target.querySelector("input.input");
    expect(nameInput().value).toBe("front");
    renameCurrentZone("back");
    flushSync();
    expect(nameInput().value).toBe("back");
    view.destroy();
  });

  it("Zone list pencil opens the inline editor", async () => {
    await load();
    const ZoneListPanel = modules["./components/panels/ZoneListPanel.svelte"].default;
    const view = mountInto(ZoneListPanel);
    expect(view.target.querySelector("input[aria-label='Zone name']")).toBeNull();
    view.target.querySelector("button[aria-label='Edit zone']").click();
    flushSync();
    expect(view.target.querySelector("input[aria-label='Zone name']").value).toBe("front");
    view.destroy();
  });

  it("Mowing settings show a changed per-zone override", async () => {
    await load();
    const { setZoneOverride } = await import("./lib/actions.js");
    const MowingSettings = modules["./components/MowingSettings.svelte"].default;
    const view = mountInto(MowingSettings);
    const values = () => [...view.target.querySelectorAll("input[type=number]")].map((i) => i.value);
    expect(values()).not.toContain("7");
    setZoneOverride("outline_count", 7);
    flushSync();
    expect(values()).toContain("7");
    view.destroy();
  });

  it("DockPanel follows a dock dragged on the map", async () => {
    const { loadMap, moveDock } = await import("./lib/stores/editor.js");
    loadMap(JSON.stringify({ ...JSON.parse(MAP), docking_stations: [{ position: { x: 1, y: 2 }, heading: 0 }] }));
    flushSync();
    const DockPanel = modules["./components/panels/DockPanel.svelte"].default;
    const view = mountInto(DockPanel);
    const coords = () => [...view.target.querySelectorAll("input[type=number]")].map((i) => i.value);
    expect(coords().slice(0, 2)).toEqual(["1.000", "2.000"]);
    moveDock({ x: 4.5, y: -3 }); // mutates the station in place, like a map drag
    flushSync();
    expect(coords().slice(0, 2)).toEqual(["4.500", "-3.000"]);
    view.destroy();
  });

  it("MeasurementsPanel totals follow an outline edit", async () => {
    await load();
    const { insertPointAtIndex } = await import("./lib/stores/editor.js");
    const MeasurementsPanel = modules["./components/panels/MeasurementsPanel.svelte"].default;
    const view = mountInto(MeasurementsPanel);
    // The all-zones "Net mowable" total, not the per-zone figures.
    const netTotal = () => view.target.querySelector(".text-ok")?.textContent;
    const before = netTotal();
    expect(before).toBeTruthy();
    insertPointAtIndex(1, { x: 5, y: -20 }); // bulge the bottom edge outwards
    flushSync();
    expect(netTotal()).not.toBe(before);
    view.destroy();
  });
});
