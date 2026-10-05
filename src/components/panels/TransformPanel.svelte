<script>
  import { currentArea } from "../../lib/stores/editor.js";
  import { currentLocked } from "../../lib/stores/zoneView.js";
  import { simplifyTolerance } from "../../lib/stores/tools.js";
  import { rotateZone, scaleZone, simplifyZoneAction, growZone } from "../../lib/actions.js";
  import Collapsible from "../Collapsible.svelte";

  const fmt = (v) => Number(v).toFixed(2).replace(/\.?0+$/, "");
  let margin = $state(0.2);
  let angle = $state(90);
  let scalePct = $state(100);
  let disabled = $derived(!$currentArea || $currentLocked);
</script>

<Collapsible title="Transform zone" icon="transform" key="transform" open={false}>
  <div class="mb-3 grid grid-cols-4 gap-2">
    <button class="btn !px-0" {disabled} title="Rotate −15°" onclick={() => rotateZone(-15)}>
      <span class="material-symbols-outlined" style="font-size:20px">rotate_left</span>
    </button>
    <button class="btn !px-0" {disabled} title="Rotate +15°" onclick={() => rotateZone(15)}>
      <span class="material-symbols-outlined" style="font-size:20px">rotate_right</span>
    </button>
    <button class="btn !px-0" {disabled} title="Scale −5%" onclick={() => scaleZone(0.95)}>
      <span class="material-symbols-outlined" style="font-size:20px">zoom_in_map</span>
    </button>
    <button class="btn !px-0" {disabled} title="Scale +5%" onclick={() => scaleZone(1.05)}>
      <span class="material-symbols-outlined" style="font-size:20px">zoom_out_map</span>
    </button>
  </div>

  <!-- Exact rotate / scale about the centroid. -->
  <div class="mb-3 grid grid-cols-2 gap-2">
    <div class="flex items-center gap-1">
      <input class="input !mt-0 !py-1 text-right font-mono" type="number" step="1" bind:value={angle} {disabled} aria-label="Rotation in degrees" />
      <button class="btn !px-2" {disabled} title="Rotate counter-clockwise by this angle" onclick={() => rotateZone(Number(angle))}>
        <span class="text-xs">°</span>
        <span class="material-symbols-outlined" style="font-size:18px">rotate_left</span>
      </button>
    </div>
    <div class="flex items-center gap-1">
      <input class="input !mt-0 !py-1 text-right font-mono" type="number" min="1" step="1" bind:value={scalePct} {disabled} aria-label="Scale in percent" />
      <button class="btn !px-2" {disabled} title="Scale to this percentage of the current size" onclick={() => scaleZone(Number(scalePct) / 100)}>
        <span class="text-xs">%</span>
        <span class="material-symbols-outlined" style="font-size:18px">zoom_out_map</span>
      </button>
    </div>
  </div>

  <!-- Grow / shrink: offset every border by a fixed margin (a buffer). -->
  <div class="mb-1 flex items-center justify-between text-xs text-muted">
    <span>Grow / shrink border (m)</span>
    <span class="font-mono text-accent">{fmt(margin)}</span>
  </div>
  <input class="slider mb-2" type="range" min="0.05" max="2" step="0.05" bind:value={margin} {disabled} />
  <div class="mb-3 grid grid-cols-2 gap-2">
    <button class="btn" {disabled} title="Move all borders outward" onclick={() => growZone(margin)}>
      <span class="material-symbols-outlined" style="font-size:18px">open_in_full</span>
      Grow
    </button>
    <button class="btn" {disabled} title="Move all borders inward" onclick={() => growZone(-margin)}>
      <span class="material-symbols-outlined" style="font-size:18px">close_fullscreen</span>
      Shrink
    </button>
  </div>

  <div class="mb-1 flex items-center justify-between text-xs text-muted">
    <span>Simplify tolerance (m)</span>
    <span class="font-mono text-accent">{fmt($simplifyTolerance)}</span>
  </div>
  <input
    class="slider mb-2"
    type="range"
    min="0.01"
    max="0.5"
    step="0.01"
    bind:value={$simplifyTolerance}
    {disabled}
  />
  <button class="btn w-full" {disabled} onclick={simplifyZoneAction}>
    <span class="material-symbols-outlined" style="font-size:18px">compress</span>
    Simplify outline
  </button>
</Collapsible>
