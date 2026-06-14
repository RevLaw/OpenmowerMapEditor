<script>
  import { slide } from "svelte/transition";
  import { activeTool, brushRadius, brushStrength } from "../../lib/stores/tools.js";

  const fmt = (v) => Number(v).toFixed(2).replace(/\.?0+$/, "");
</script>

{#if $activeTool === "brush"}
  <section class="card" transition:slide|local={{ duration: 160 }}>
    <h2 class="card-title">
      <span class="material-symbols-outlined" style="font-size:16px">blur_circular</span>
      Push brush
    </h2>
    <p class="mb-2 text-[11px] text-subtle">Drag across the outline to push points along your stroke.</p>
    <div class="mb-1 flex items-center justify-between text-xs text-muted">
      <span>Radius (m)</span>
      <span class="font-mono text-accent">{fmt($brushRadius)}</span>
    </div>
    <input class="slider mb-3" type="range" min="0.05" max="2" step="0.05" bind:value={$brushRadius} />
    <div class="mb-1 flex items-center justify-between text-xs text-muted">
      <span>Strength</span>
      <span class="font-mono text-accent">{fmt($brushStrength)}</span>
    </div>
    <input class="slider" type="range" min="0.05" max="1" step="0.05" bind:value={$brushStrength} />
  </section>
{/if}
