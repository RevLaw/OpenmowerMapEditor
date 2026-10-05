<script>
  import { fly } from "svelte/transition";
  import { editor, currentArea } from "../lib/stores/editor.js";
  import { getAreaType, getZoneName } from "../lib/format/mapFormat.js";
  import { getEditablePoints } from "../lib/format/outline.js";
  import { polygonArea } from "../lib/geo/geometry.js";
  import { formatArea } from "../lib/measurements.js";
  import { mapApi } from "../lib/stores/mapApi.js";
  import { lockedZones, hiddenZones, zoneKey, toggleZoneLocked, toggleZoneHidden } from "../lib/stores/zoneView.js";
  import { duplicateZoneAction, removeCurrentZone } from "../lib/actions.js";
  import { sidebarTab } from "../lib/stores/ui.js";

  const TYPE_DOT = { mow: "#22c55e", obstacle: "#ef4444", nav: "#38bdf8" };

  // Floating quick actions for the selected zone, next to the map rather than
  // buried in the sidebar.
  let index = $derived($editor.areaIndex);
  let type = $derived(getAreaType($currentArea));
  let pts = $derived($currentArea ? getEditablePoints($currentArea.outline || []) : []);
  let key = $derived($currentArea ? zoneKey($currentArea, index) : "");
  let isLocked = $derived($lockedZones.has(key));
  let isHidden = $derived($hiddenZones.has(key));
</script>

{#if $currentArea}
  <div
    class="glass flex items-center gap-1 rounded-2xl py-1 pl-3 pr-1"
    transition:fly={{ y: 12, duration: 160 }}
  >
    <button
      class="flex min-w-0 items-center gap-2 pr-1 text-left"
      title="Show zone details"
      onclick={() => sidebarTab.set("zones")}
    >
      <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:{TYPE_DOT[type] || '#94a3b8'}"></span>
      <span class="min-w-0">
        <span class="block max-w-[34vw] truncate text-xs font-semibold sm:max-w-[200px]">
          {getZoneName($currentArea, index)}
        </span>
        <span class="block text-[10px] text-subtle">
          {type} · {formatArea(polygonArea(pts))} · {pts.length} pts
          {#if $editor.pointIndex != null}· vertex {$editor.pointIndex + 1}{/if}
        </span>
      </span>
    </button>
    <div class="mx-1 h-7 w-px" style="background:var(--edge-soft)"></div>
    <button class="btn-icon !h-8 !w-8" title="Fit to view (F)" onclick={() => $mapApi?.fitCurrentArea()}>
      <span class="material-symbols-outlined" style="font-size:19px">fit_screen</span>
    </button>
    <button class="btn-icon !h-8 !w-8" title="Duplicate (Ctrl+D)" onclick={duplicateZoneAction}>
      <span class="material-symbols-outlined" style="font-size:19px">content_copy</span>
    </button>
    <button
      class="btn-icon !h-8 !w-8"
      class:text-accent={isLocked}
      title={isLocked ? "Unlock zone" : "Lock zone (prevent edits)"}
      onclick={() => toggleZoneLocked($currentArea, index)}
    >
      <span class="material-symbols-outlined" style="font-size:19px">{isLocked ? "lock" : "lock_open"}</span>
    </button>
    <button
      class="btn-icon !h-8 !w-8"
      title={isHidden ? "Show zone" : "Hide zone on the map"}
      onclick={() => toggleZoneHidden($currentArea, index)}
    >
      <span class="material-symbols-outlined" style="font-size:19px">{isHidden ? "visibility_off" : "visibility"}</span>
    </button>
    <button
      class="btn-icon !h-8 !w-8 hover:!text-[var(--danger)]"
      title="Delete zone"
      disabled={isLocked}
      onclick={removeCurrentZone}
    >
      <span class="material-symbols-outlined" style="font-size:19px">delete</span>
    </button>
  </div>
{/if}
