<script>
  import Collapsible from "../Collapsible.svelte";
  import { editor, setAreaIndex } from "../../lib/stores/editor.js";
  import { getAreaType, getZoneName } from "../../lib/format/mapFormat.js";
  import { getEditablePoints } from "../../lib/format/outline.js";
  import { polygonArea } from "../../lib/geo/geometry.js";
  import { formatArea } from "../../lib/measurements.js";
  import {
    hiddenZones,
    lockedZones,
    zoneKey,
    toggleZoneHidden,
    toggleZoneLocked,
    showAllZones,
  } from "../../lib/stores/zoneView.js";
  import { drawZoneType } from "../../lib/stores/tools.js";
  import { mapApi } from "../../lib/stores/mapApi.js";
  import { sidebarOpen, isNarrowScreen } from "../../lib/stores/ui.js";

  const TYPES = [
    { id: "mow", label: "Mow", color: "#22c55e" },
    { id: "obstacle", label: "Obstacle", color: "#ef4444" },
    { id: "nav", label: "Nav", color: "#38bdf8" },
  ];
  const COLOR = Object.fromEntries(TYPES.map((t) => [t.id, t.color]));

  // Read $editor directly: zones are mutated in place, so derived aliases of
  // the areas array would never refresh.
  let rows = $derived(
    ($editor.mapData?.areas || []).map((area, i) => {
      const key = zoneKey(area, i);
      return {
        index: i,
        name: getZoneName(area, i),
        type: getAreaType(area),
        area: polygonArea(getEditablePoints(area.outline || [])),
        hidden: $hiddenZones.has(key),
        locked: $lockedZones.has(key),
        raw: area,
      };
    })
  );
  let hiddenCount = $derived(rows.filter((r) => r.hidden).length);

  function pick(i) {
    setAreaIndex(i);
    // On a phone the open panel covers the map — fold it to show the zone.
    if (isNarrowScreen()) sidebarOpen.set(false);
    $mapApi?.fitCurrentArea();
  }
</script>

<Collapsible title="Zones" icon="layers" key="zonelist">
  {#snippet badge()}
    <span class="chip">{rows.length}</span>
  {/snippet}

  {#if !$editor.mapData}
    <p class="text-[11px] text-subtle">Load a map to see its zones.</p>
  {:else}
    {#if rows.length === 0}
      <p class="mb-2 text-[11px] text-subtle">No zones yet — draw one with the tools on the right.</p>
    {:else}
      <ul class="scroll-thin -mx-1 mb-2 max-h-[34vh] space-y-0.5 overflow-y-auto px-1" role="listbox" aria-label="Zones">
        {#each rows as r (r.index)}
          <li
            class="zone-row group flex items-center gap-1 rounded-lg pl-2 pr-0.5"
            class:selected={r.index === $editor.areaIndex}
            class:dim={r.hidden}
          >
            <button
              class="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
              role="option"
              aria-selected={r.index === $editor.areaIndex}
              onclick={() => pick(r.index)}
            >
              <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background:{COLOR[r.type] || '#94a3b8'}"></span>
              <span class="min-w-0 flex-1 truncate text-xs">{r.name}</span>
              <span class="shrink-0 font-mono text-[10px] text-subtle">{formatArea(r.area)}</span>
            </button>
            <button
              class="btn-icon !h-7 !w-7"
              class:on={r.locked}
              title={r.locked ? "Unlock" : "Lock (prevent edits)"}
              onclick={() => toggleZoneLocked(r.raw, r.index)}
            >
              <span class="material-symbols-outlined" style="font-size:16px">{r.locked ? "lock" : "lock_open"}</span>
            </button>
            <button
              class="btn-icon !h-7 !w-7"
              title={r.hidden ? "Show on map" : "Hide on map"}
              onclick={() => toggleZoneHidden(r.raw, r.index)}
            >
              <span class="material-symbols-outlined" style="font-size:16px">{r.hidden ? "visibility_off" : "visibility"}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if hiddenCount}
        <button class="mb-2 text-[11px] text-accent hover:underline" onclick={showAllZones}>
          Show all ({hiddenCount} hidden)
        </button>
      {/if}
    {/if}

    <div class="border-t pt-2" style="border-color:var(--edge-soft)">
      <div class="mb-1.5 flex items-center justify-between">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-subtle">New zones are</span>
        <div class="flex rounded-lg p-0.5" style="background:var(--surface-2)" role="radiogroup" aria-label="New zone type">
          {#each TYPES as t}
            <button
              class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
              style={$drawZoneType === t.id ? "background:var(--surface-3);color:var(--ink)" : "color:var(--subtle)"}
              role="radio"
              aria-checked={$drawZoneType === t.id}
              onclick={() => drawZoneType.set(t.id)}
            >
              <span class="h-2 w-2 rounded-sm" style="background:{t.color}"></span>
              {t.label}
            </button>
          {/each}
        </div>
      </div>
      <p class="text-[10px] text-subtle">
        Draw with the polygon / rectangle / circle tools on the right, or right-click the map.
      </p>
    </div>
  {/if}
</Collapsible>

<style>
  .zone-row:hover {
    background: var(--surface-2);
  }
  .zone-row.selected {
    background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .zone-row.dim .truncate {
    color: var(--subtle);
    text-decoration: line-through;
  }
  .zone-row .btn-icon {
    opacity: 0.55;
  }
  .zone-row:hover .btn-icon,
  .zone-row .btn-icon.on {
    opacity: 1;
  }
  .zone-row .btn-icon.on {
    color: var(--accent);
  }
</style>
