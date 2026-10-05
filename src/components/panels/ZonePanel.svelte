<script>
  import Collapsible from "../Collapsible.svelte";
  import { currentArea, editor } from "../../lib/stores/editor.js";
  import { currentLocked } from "../../lib/stores/zoneView.js";
  import { getAreaType, getZoneName } from "../../lib/format/mapFormat.js";
  import {
    changeZoneType,
    renameCurrentZone,
    moveZoneOrder,
  } from "../../lib/actions.js";

  let nameDraft = $state("");
  let editingName = $state(false);

  // Read $currentArea directly rather than through a `$derived` alias: the editor
  // store mutates zones in place, and a derived of the same object reference
  // would never invalidate its dependents.
  let type = $derived(getAreaType($currentArea));
  let index = $derived($editor.areaIndex);
  let count = $derived($editor.mapData?.areas?.length ?? 0);
  let currentName = $derived($currentArea?.properties?.name?.trim() ?? "");
  // Keep the name field synced with the selected zone unless it's being edited.
  $effect.pre(() => {
    if ($currentArea && !editingName) nameDraft = currentName;
  });

  function commitName() {
    editingName = false;
    // Only commit when the name actually changed (avoid a no-op undo entry).
    if ($currentArea && nameDraft.trim() !== currentName) {
      renameCurrentZone(nameDraft);
    }
  }
</script>

{#if $currentArea}
  <Collapsible title="Zone details" icon="category" key="zone">
    {#if $currentLocked}
      <p class="mb-1.5 flex items-center gap-1.5 text-[11px]" style="color:var(--warn)">
        <span class="material-symbols-outlined" style="font-size:15px">lock</span>
        Locked — unlock it in the zone list to edit.
      </p>
    {/if}
    <div class="mb-1.5 grid grid-cols-[1fr_auto] gap-1.5">
      <label class="field !mb-0">
        Name
        <input
          class="input"
          placeholder={getZoneName($currentArea, index)}
          disabled={$currentLocked}
          bind:value={nameDraft}
          onfocus={() => (editingName = true)}
          onblur={commitName}
          onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
      <label class="field !mb-0">
        Type
        <select class="select block !w-28" value={type} disabled={$currentLocked} onchange={(e) => changeZoneType(e.target.value)}>
          <option value="mow">mow</option>
          <option value="obstacle">obstacle</option>
          <option value="nav">nav</option>
        </select>
      </label>
    </div>

    <div class="flex items-center gap-1">
      <span class="min-w-0 flex-1 truncate text-[10px] text-subtle" title={$currentArea.id}>id: {$currentArea.id}</span>
      <span class="text-[10px] text-subtle">#{index + 1} of {count}</span>
      <button class="btn-icon !h-7 !w-7" title="Move up in the list" aria-label="Move zone up" disabled={index <= 0} onclick={() => moveZoneOrder(-1)}>
        <span class="material-symbols-outlined" style="font-size:18px">arrow_upward</span>
      </button>
      <button class="btn-icon !h-7 !w-7" title="Move down in the list" aria-label="Move zone down" disabled={index >= count - 1} onclick={() => moveZoneOrder(1)}>
        <span class="material-symbols-outlined" style="font-size:18px">arrow_downward</span>
      </button>
    </div>
  </Collapsible>
{/if}
