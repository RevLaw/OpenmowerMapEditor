<script>
  import { editor, currentArea } from "../../lib/stores/editor.js";
  import {
    zoneMeasurement,
    totalMowArea,
    formatArea,
    formatLength,
  } from "../../lib/measurements.js";
  import { getAreaType } from "../../lib/format/mapFormat.js";
  import Collapsible from "../Collapsible.svelte";

  // $editor.rev bumps on every edit, so these recompute live.
  $: areas = $editor.mapData?.areas || [];
  $: cur = $currentArea ? zoneMeasurement($currentArea) : null;
  $: totals = totalMowArea(areas);
</script>

<Collapsible title="Measurements" icon="straighten" key="measure">
  {#if cur}
    <div class="mb-2 grid grid-cols-3 gap-2 text-center">
      <div class="rounded-lg py-1.5" style="background:var(--surface-2)">
        <div class="text-sm font-semibold text-accent">{formatArea(cur.area)}</div>
        <div class="text-[10px] uppercase tracking-wide text-subtle">{getAreaType($currentArea)} area</div>
      </div>
      <div class="rounded-lg py-1.5" style="background:var(--surface-2)">
        <div class="text-sm font-semibold">{formatLength(cur.perimeter)}</div>
        <div class="text-[10px] uppercase tracking-wide text-subtle">perimeter</div>
      </div>
      <div class="rounded-lg py-1.5" style="background:var(--surface-2)">
        <div class="text-sm font-semibold">{cur.points}</div>
        <div class="text-[10px] uppercase tracking-wide text-subtle">points</div>
      </div>
    </div>
  {:else}
    <p class="mb-2 text-[11px] text-subtle">No zone selected.</p>
  {/if}

  <div class="flex items-center justify-between border-t pt-2 text-xs" style="border-color:var(--edge-soft)">
    <span class="text-muted">Net mowable</span>
    <span class="font-semibold text-ok">{formatArea(totals.net)}</span>
  </div>
  <div class="mt-1 flex items-center justify-between text-[11px] text-subtle">
    <span>{formatArea(totals.mow)} mow − {formatArea(totals.obstacle)} obstacles</span>
  </div>
</Collapsible>
