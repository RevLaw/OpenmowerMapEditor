import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { editor, loadMap, applyBrush, applyBrushSteps } from "./editor.js";

const ring = (pts) => [...pts, pts[0]];
const MAP = JSON.stringify({
  areas: [
    {
      id: "a",
      properties: { type: "mow" },
      outline: ring(Array.from({ length: 40 }, (_, i) => ({ x: i * 0.25, y: 0 })).concat([{ x: 10, y: 5 }, { x: 0, y: 5 }])),
    },
  ],
});

const steps = Array.from({ length: 12 }, (_, i) => ({
  center: { x: 3 + i * 0.1, y: 0.05 * i },
  delta: { x: 0.1, y: 0.05 },
}));

describe("applyBrushSteps", () => {
  it("matches applying the same steps one by one, with a single store update", () => {
    loadMap(MAP);
    for (const st of steps) applyBrush(st.center, st.delta, 0.5, 0.7);
    const sequential = get(editor).mapData.areas[0].outline;

    loadMap(MAP);
    let emissions = 0;
    const unsub = editor.subscribe(() => (emissions += 1));
    emissions = 0;
    const moved = applyBrushSteps(steps, 0.5, 0.7);
    unsub();
    expect(get(editor).mapData.areas[0].outline).toEqual(sequential);
    expect(moved).toBeGreaterThan(0);
    expect(emissions).toBe(1);
  });

  it("is a no-op without steps", () => {
    loadMap(MAP);
    const rev = get(editor).rev;
    expect(applyBrushSteps([], 0.5, 0.7)).toBe(0);
    expect(get(editor).rev).toBe(rev);
  });
});
