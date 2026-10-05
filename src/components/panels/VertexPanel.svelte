<script>
  import Collapsible from "../Collapsible.svelte";
  import { editor, currentArea } from "../../lib/stores/editor.js";
  import { getEditablePoints } from "../../lib/format/outline.js";
  import { setVertexCoords, makeStartPoint, removePoint, addRobotPointToZone } from "../../lib/actions.js";
  import { currentLocked } from "../../lib/stores/zoneView.js";
  import { robotLive } from "../../lib/stores/robot.js";

  // Exact vertex coordinates (map meters, the frame map.json stores).
  let idx = $derived($editor.pointIndex);
  let pts = $derived($currentArea ? getEditablePoints($currentArea.outline || []) : []);
  let point = $derived(idx != null ? pts[idx] : null);
  let multi = $derived($editor.selectedPointIndices.length);

  let x = $state("");
  let y = $state("");
  let editing = $state(false);

  $effect.pre(() => {
    if (!editing) {
      x = point ? point.x.toFixed(3) : "";
      y = point ? point.y.toFixed(3) : "";
    }
  });

  function apply() {
    editing = false;
    if (idx == null || !point) return;
    // Untouched fields keep full precision (the inputs show 3 decimals).
    const nx = x === point.x.toFixed(3) ? point.x : Number(x);
    const ny = y === point.y.toFixed(3) ? point.y : Number(y);
    if (Math.abs(nx - point.x) < 1e-6 && Math.abs(ny - point.y) < 1e-6) return;
    setVertexCoords(idx, nx, ny);
  }

  function onKey(e) {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      editing = false;
      e.currentTarget.blur();
    }
  }
</script>

{#if $currentArea}
  <Collapsible title="Vertex" icon="edit_location_alt" key="vertex" open={false}>
    {#if multi > 0}
      <p class="mb-2 text-[11px] text-subtle">
        {multi} point{multi === 1 ? "" : "s"} selected — drag the handle to move them, arrows to nudge.
      </p>
      <button class="btn w-full" disabled={$currentLocked} onclick={removePoint}>
        <span class="material-symbols-outlined" style="font-size:18px">delete</span>
        Delete selected
      </button>
    {:else if point}
      <p class="mb-2 text-[11px] text-subtle">
        Point {idx + 1} of {pts.length}{idx === 0 ? " · start point" : ""}. Coordinates in map meters.
      </p>
      <div class="mb-2 grid grid-cols-2 gap-2">
        <label class="field !mb-0">
          X (east)
          <input
            class="input font-mono"
            type="number"
            step="0.01"
            disabled={$currentLocked}
            bind:value={x}
            onfocus={() => (editing = true)}
            onblur={apply}
            onkeydown={onKey}
          />
        </label>
        <label class="field !mb-0">
          Y (north)
          <input
            class="input font-mono"
            type="number"
            step="0.01"
            disabled={$currentLocked}
            bind:value={y}
            onfocus={() => (editing = true)}
            onblur={apply}
            onkeydown={onKey}
          />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="btn !px-2 text-xs"
          disabled={$currentLocked || idx === 0}
          title="OpenMower measures the automatic mow angle from the first outline edge"
          onclick={() => makeStartPoint(idx)}
        >
          <span class="material-symbols-outlined" style="font-size:17px">flag</span>
          Make start
        </button>
        <button class="btn !px-2 text-xs" disabled={$currentLocked || pts.length <= 3} onclick={removePoint}>
          <span class="material-symbols-outlined" style="font-size:17px">delete</span>
          Delete
        </button>
      </div>
    {:else}
      <p class="mb-2 text-[11px] text-subtle">
        Click a vertex to edit its exact coordinates. Drag the small dots on edges to add points.
      </p>
    {/if}
    <button
      class="btn mt-2 w-full text-xs"
      disabled={$currentLocked || !$robotLive}
      title={$robotLive ? "Insert the robot's current position on the nearest edge" : "Turn on Live robot first"}
      onclick={addRobotPointToZone}
    >
      <span class="material-symbols-outlined" style="font-size:17px">my_location</span>
      Add robot position as vertex
    </button>
  </Collapsible>
{/if}
