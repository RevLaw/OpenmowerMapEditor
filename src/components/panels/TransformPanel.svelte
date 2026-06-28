<script>
  import { currentArea } from "../../lib/stores/editor.js";
  import { simplifyTolerance } from "../../lib/stores/tools.js";
  import { rotateZone, scaleZone, simplifyZoneAction, growZone } from "../../lib/actions.js";

  const fmt = (v) => Number(v).toFixed(2).replace(/\.?0+$/, "");
  let margin = 0.2;
  $: disabled = !$currentArea;
</script>

<section class="card">
  <h2 class="card-title">
    <span class="material-symbols-outlined" style="font-size:16px">transform</span>
    Transform zone
  </h2>

  <div class="mb-3 grid grid-cols-4 gap-2">
    <button class="btn !px-0" {disabled} title="Rotate −15°" on:click={() => rotateZone(-15)}>
      <span class="material-symbols-outlined" style="font-size:20px">rotate_left</span>
    </button>
    <button class="btn !px-0" {disabled} title="Rotate +15°" on:click={() => rotateZone(15)}>
      <span class="material-symbols-outlined" style="font-size:20px">rotate_right</span>
    </button>
    <button class="btn !px-0" {disabled} title="Scale −5%" on:click={() => scaleZone(0.95)}>
      <span class="material-symbols-outlined" style="font-size:20px">zoom_in_map</span>
    </button>
    <button class="btn !px-0" {disabled} title="Scale +5%" on:click={() => scaleZone(1.05)}>
      <span class="material-symbols-outlined" style="font-size:20px">zoom_out_map</span>
    </button>
  </div>

  <!-- Grow / shrink: offset every border by a fixed margin (a buffer). -->
  <div class="mb-1 flex items-center justify-between text-xs text-muted">
    <span>Grow / shrink border (m)</span>
    <span class="font-mono text-accent">{fmt(margin)}</span>
  </div>
  <input class="slider mb-2" type="range" min="0.05" max="2" step="0.05" bind:value={margin} {disabled} />
  <div class="mb-3 grid grid-cols-2 gap-2">
    <button class="btn" {disabled} title="Move all borders outward" on:click={() => growZone(margin)}>
      <span class="material-symbols-outlined" style="font-size:18px">open_in_full</span>
      Grow
    </button>
    <button class="btn" {disabled} title="Move all borders inward" on:click={() => growZone(-margin)}>
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
  <button class="btn w-full" {disabled} on:click={simplifyZoneAction}>
    <span class="material-symbols-outlined" style="font-size:18px">compress</span>
    Simplify outline
  </button>
</section>
