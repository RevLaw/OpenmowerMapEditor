// @vitest-environment happy-dom
// Runtime smoke test: confirm Svelte 5 mounts our components (stores, reactive
// statements, transitions) without throwing — e.g. the `effect_orphan` error
// that a production build can't catch.
import { describe, it, expect } from "vitest";
import { mount, unmount } from "svelte";
import ToolHint from "./components/ToolHint.svelte";
import ProjectionPanel from "./components/panels/ProjectionPanel.svelte";
import CoveragePanel from "./components/panels/CoveragePanel.svelte";
import ZonePanel from "./components/panels/ZonePanel.svelte";
import ThemeToggle from "./components/ThemeToggle.svelte";

function mountOk(Component) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(Component, { target });
  unmount(instance);
  target.remove();
}

describe("Svelte 5 mount smoke", () => {
  for (const [name, Component] of [
    ["ToolHint", ToolHint],
    ["ProjectionPanel", ProjectionPanel],
    ["CoveragePanel", CoveragePanel],
    ["ZonePanel", ZonePanel],
    ["ThemeToggle", ThemeToggle],
  ]) {
    it(`mounts ${name} without error`, () => {
      expect(() => mountOk(Component)).not.toThrow();
    });
  }
});
