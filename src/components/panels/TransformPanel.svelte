<script>
  import { onDestroy } from "svelte";
  import { currentArea } from "../../lib/stores/editor.js";
  import { currentLocked } from "../../lib/stores/zoneView.js";
  import { simplifyTolerance, simplifyPreviewOn } from "../../lib/stores/tools.js";
  import { simplifyZoneAction } from "../../lib/actions.js";
  import { getEditablePoints } from "../../lib/format/outline.js";
  import { simplify, polygonArea } from "../../lib/geo/geometry.js";
  import { formatArea } from "../../lib/measurements.js";
  import Collapsible from "../Collapsible.svelte";

  const fmt = (v) => Number(v).toFixed(2).replace(/\.?0+$/, "");

  // The map previews the simplified outline (dashed) while this panel is open,
  // so the tolerance can be tuned before anything changes.
  let open = $state(false);
  let disabled = $derived(!$currentArea || $currentLocked);
  $effect(() => {
    simplifyPreviewOn.set(open && Boolean($currentArea));
  });
  onDestroy(() => simplifyPreviewOn.set(false));

  // Read $currentArea directly (zones are mutated in place).
  let pts = $derived($currentArea ? getEditablePoints($currentArea.outline || []) : []);
  let kept = $derived(pts.length >= 3 ? simplify(pts, $simplifyTolerance) : pts);
  let removed = $derived(pts.length - kept.length);
  let areaDelta = $derived(polygonArea(kept) - polygonArea(pts));
</script>

<Collapsible title="Simplify outline" icon="compress" key="transform" bind:open>
  <p class="mb-1.5 text-[11px] text-subtle">
    Removes points that barely change the shape. The <span style="color:#e879f9">dashed outline</span> on the map
    previews the result.
  </p>
  <div class="mb-1 flex items-center justify-between text-xs text-muted">
    <span>Tolerance (m)</span>
    <span class="font-mono text-accent">{fmt($simplifyTolerance)}</span>
  </div>
  <input
    class="slider mb-1.5"
    type="range"
    min="0.01"
    max="0.5"
    step="0.01"
    bind:value={$simplifyTolerance}
    {disabled}
  />
  {#if pts.length >= 3}
    <div class="mb-2 flex items-center justify-between text-[11px]">
      <span class="font-mono">
        {pts.length} → <b style="color:#e879f9">{kept.length}</b> points
      </span>
      <span class="text-subtle">
        {#if removed > 0}
          −{Math.round((removed / pts.length) * 100)}% · {areaDelta >= 0 ? "+" : "−"}{formatArea(Math.abs(areaDelta))}
        {:else}
          nothing to remove
        {/if}
      </span>
    </div>
  {/if}
  <button class="btn btn-accent w-full" disabled={disabled || removed <= 0} onclick={simplifyZoneAction}>
    <span class="material-symbols-outlined" style="font-size:18px">check</span>
    Apply{removed > 0 ? ` — remove ${removed} point${removed === 1 ? "" : "s"}` : ""}
  </button>
</Collapsible>
