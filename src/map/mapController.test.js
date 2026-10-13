// @vitest-environment happy-dom
// Map interaction checks that need the real Leaflet layers: a click on a
// rendered shape has to reach the right store action.
import { describe, it, expect, afterEach } from "vitest";
import { get } from "svelte/store";
import { createMapController } from "./mapController.js";
import { loadMap, setAreaIndex } from "../lib/stores/editor.js";
import { gotoState, armGoto, cancelGoto } from "../lib/stores/goto.js";

const SQUARE = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
];
const MAP = {
  areas: [{ name: "lawn", properties: { type: "mow" }, outline: SQUARE }],
  docking_stations: [{ position: { x: 0, y: -6 }, heading: Math.PI / 2 }],
};

let controller = null;
let container = null;

function mountMap() {
  container = document.createElement("div");
  container.style.width = "800px";
  container.style.height = "600px";
  document.body.appendChild(container);
  controller = createMapController(container);
}

function click(el) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 400, clientY: 300, button: 0 }));
}

afterEach(() => {
  cancelGoto();
  controller?.destroy?.();
  container?.remove();
  controller = container = null;
});

describe("go-to target picking", () => {
  // The only zone of a single-zone map is always the selected one, drawn as the
  // highlighted outline — a tap on the lawn lands on that shape.
  it("a tap on the selected zone picks the target", () => {
    loadMap(structuredClone(MAP));
    setAreaIndex(0);
    mountMap();
    armGoto();
    const shape = [...container.querySelectorAll("path.leaflet-interactive")].find(
      (p) => p.getAttribute("stroke") === "#ffffff"
    );
    expect(shape).toBeTruthy();
    click(shape);
    // Without drive mode the pick is refused — but with a reason, not silently.
    expect(get(gotoState).reason).toBe("Start drive mode first.");
  });

  it("a tap on the dock marker picks the target", () => {
    loadMap(structuredClone(MAP));
    mountMap();
    armGoto();
    const dock = container.querySelector(".map-marker--dock")?.closest(".leaflet-marker-icon");
    expect(dock).toBeTruthy();
    click(dock);
    expect(get(gotoState).reason).toBe("Start drive mode first.");
  });
});
