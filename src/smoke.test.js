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
