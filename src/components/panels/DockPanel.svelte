<script>
  import Collapsible from "../Collapsible.svelte";
  import { editor } from "../../lib/stores/editor.js";
  import { activeTool, toggleTool } from "../../lib/stores/tools.js";
  import { robotLive } from "../../lib/stores/robot.js";
  import { setDockExact, setDockFromRobot, removeDockAction } from "../../lib/actions.js";
  import { mapApi } from "../../lib/stores/mapApi.js";

  // Derive plain numbers, not the station object: dragging the dock mutates
  // it in place, and a derived of the same object reference never updates.
  let dockX = $derived($editor.mapData?.docking_stations?.[0]?.position?.x ?? null);
  let dockY = $derived($editor.mapData?.docking_stations?.[0]?.position?.y ?? null);
  let dockHeading = $derived($editor.mapData?.docking_stations?.[0]?.heading ?? null);
  let has = $derived(Number.isFinite(dockX) && Number.isFinite(dockY));
  let headingDeg = $derived(
    Number.isFinite(dockHeading) ? Math.round(((dockHeading * 180) / Math.PI) * 10) / 10 : null
  );

  let x = $state("");
  let y = $state("");
  let h = $state("");
  let editing = $state(false);

  $effect.pre(() => {
    if (!editing) {
      x = has ? dockX.toFixed(3) : "";
      y = has ? dockY.toFixed(3) : "";
      h = headingDeg != null ? String(headingDeg) : "";
    }
  });

  function apply() {
    editing = false;
    if (!has) return;
    // Untouched fields keep full precision (the inputs show 3 decimals).
    const nx = x === dockX.toFixed(3) ? dockX : Number(x);
    const ny = y === dockY.toFixed(3) ? dockY : Number(y);
    const nh = h === "" ? null : Number(h);
    const moved = Math.abs(nx - dockX) > 1e-6 || Math.abs(ny - dockY) > 1e-6;
    const turned = nh != null && Number.isFinite(nh) && nh !== headingDeg;
    if (moved || turned) setDockExact({ x: nx, y: ny, headingDeg: turned ? nh : undefined });
  }

  function onKey(e) {
    if (e.key === "Enter") e.currentTarget.blur();
  }

</script>

<Collapsible title="Docking station" icon="ev_station" key="dock">
  {#if !$editor.mapData}
    <p class="text-[11px] text-subtle">Load a map first.</p>
  {:else}
    {#if has}
      <div class="mb-2 grid grid-cols-3 gap-2">
        <label class="field !mb-0">
          X (m)
          <input class="input font-mono" type="number" step="0.01" bind:value={x} onfocus={() => (editing = true)} onblur={apply} onkeydown={onKey} />
        </label>
        <label class="field !mb-0">
          Y (m)
          <input class="input font-mono" type="number" step="0.01" bind:value={y} onfocus={() => (editing = true)} onblur={apply} onkeydown={onKey} />
        </label>
        <label class="field !mb-0">
          Heading °
          <input class="input font-mono" type="number" step="1" placeholder="—" bind:value={h} onfocus={() => (editing = true)} onblur={apply} onkeydown={onKey} />
        </label>
      </div>
      <p class="mb-2 text-[10px] text-subtle">
        Heading is the direction the mower faces when docked (0° = east, 90° = north).
      </p>
      <div class="mb-2 grid grid-cols-2 gap-1.5">
        <button class="btn !px-0" title="Pan to the dock" onclick={() => $mapApi?.panToPoint({ x: dockX, y: dockY })}>
          <span class="material-symbols-outlined" style="font-size:18px">center_focus_strong</span>
        </button>
        <button class="btn !px-0 hover:!text-[var(--danger)]" title="Remove docking station" onclick={removeDockAction}>
          <span class="material-symbols-outlined" style="font-size:18px">delete</span>
        </button>
      </div>
    {:else}
      <p class="mb-2 text-[11px] text-subtle">This map has no docking station yet.</p>
    {/if}
    <div class="grid grid-cols-2 gap-2">
      <button class="btn !px-2 text-xs" class:btn-accent={$activeTool === "dock"} onclick={() => toggleTool("dock")}>
        <span class="material-symbols-outlined" style="font-size:17px">ads_click</span>
        {has ? "Move by click" : "Place by click"}
      </button>
      <button
        class="btn !px-2 text-xs"
        disabled={!$robotLive}
        title={$robotLive ? "Use the robot's live position and heading (while it sits in the dock)" : "Turn on Live robot first"}
        onclick={setDockFromRobot}
      >
        <span class="material-symbols-outlined" style="font-size:17px">my_location</span>
        From robot
      </button>
    </div>
  {/if}
</Collapsible>
