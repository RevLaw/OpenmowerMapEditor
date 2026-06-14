<script>
  import { slide } from "svelte/transition";
  import {
    coverageOn,
    coverageSpacing,
    coverageAngle,
    coverageAbsolute,
    coveragePasses,
  } from "../../lib/stores/tools.js";
  import { currentArea } from "../../lib/stores/editor.js";
  import { getAreaType } from "../../lib/format/mapFormat.js";

  const fmt = (v) => Number(v).toFixed(2).replace(/\.?0+$/, "");
  $: isMow = getAreaType($currentArea) === "mow";
</script>

<section class="card">
  <h2 class="card-title justify-between">
    <span class="flex items-center gap-2">
      <span class="material-symbols-outlined" style="font-size:16px">grid_on</span>
      Mowing preview
    </span>
    <button
      class="btn-icon !h-7 !w-7"
      class:text-accent={$coverageOn}
      title="Toggle coverage overlay"
      on:click={() => coverageOn.update((v) => !v)}
    >
      <span class="material-symbols-outlined" style="font-size:22px">
        {$coverageOn ? "toggle_on" : "toggle_off"}
      </span>
    </button>
  </h2>

  {#if $coverageOn}
    <div transition:slide|local={{ duration: 160 }}>
      {#if !isMow}
        <p class="mb-2 text-[11px] text-subtle">Select a <b>mow</b> zone to preview its coverage.</p>
      {/if}

      <div class="mb-1 flex items-center justify-between text-xs text-muted">
        <span>Tool width (m)</span>
        <span class="font-mono text-accent">{fmt($coverageSpacing)}</span>
      </div>
      <input class="slider mb-3" type="range" min="0.1" max="1" step="0.05" bind:value={$coverageSpacing} />

      <div class="mb-1 flex items-center justify-between text-xs text-muted">
        <span>Mow angle offset (°)</span>
        <span class="font-mono text-accent">{Math.round($coverageAngle)}</span>
      </div>
      <input class="slider mb-2" type="range" min="0" max="180" step="5" bind:value={$coverageAngle} />

      <label class="mb-3 flex cursor-pointer items-center justify-between text-xs text-muted">
        <span>Absolute angle <span class="text-subtle">(else relative to zone)</span></span>
        <input type="checkbox" class="accent-[var(--accent)]" bind:checked={$coverageAbsolute} />
      </label>

      <div class="mb-1 flex items-center justify-between text-xs text-muted">
        <span>Outline laps (driven first)</span>
        <span class="font-mono text-accent">{Math.round($coveragePasses)}</span>
      </div>
      <input class="slider" type="range" min="0" max="4" step="1" bind:value={$coveragePasses} />

      <div class="mt-3 flex items-center gap-3 text-[10px] text-subtle">
        <span class="flex items-center gap-1">
          <span class="inline-block h-0.5 w-4 rounded" style="background:var(--ok)"></span>
          outline (first)
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-0.5 w-4 rounded" style="background:var(--accent-2)"></span>
          fill rows
        </span>
      </div>
      <p class="mt-2 text-[10px] leading-relaxed text-subtle">
        Mirrors OpenMower <code class="text-muted">mow_angle_offset</code>,
        <code class="text-muted">mow_angle_offset_is_absolute</code>,
        <code class="text-muted">outline_overlap_count</code>. Preview only — saved locally, not written to map.json.
      </p>
    </div>
  {:else}
    <p class="text-[11px] text-subtle">Overlay the rows the robot drives — outline first, then fill.</p>
  {/if}
</section>
