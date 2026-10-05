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
      <p class="mb-2 flex items-center gap-1.5 text-[11px]" style="color:var(--warn)">
        <span class="material-symbols-outlined" style="font-size:15px">lock</span>
        Locked — unlock it in the zone list to edit.
      </p>
    {/if}
    <label class="field">
      Type
      <select class="select" value={type} disabled={$currentLocked} onchange={(e) => changeZoneType(e.target.value)}>
        <option value="mow">mow</option>
        <option value="obstacle">obstacle</option>
        <option value="nav">nav</option>
      </select>
    </label>

    <label class="field">
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
    <p class="mb-2 truncate text-[10px] text-subtle" title={$currentArea.id}>id: {$currentArea.id}</p>

    {#if type === "mow"}
      <p class="mb-2 text-[10px] text-subtle">
        Set this zone's cutting parameters in the <b>Mowing</b> panel below.
      </p>
    {/if}

    <div class="grid grid-cols-2 gap-2">
      <button class="btn" disabled={index <= 0} onclick={() => moveZoneOrder(-1)}>
        <span class="material-symbols-outlined" style="font-size:18px">arrow_upward</span>
        Move up
      </button>
      <button class="btn" disabled={index >= count - 1} onclick={() => moveZoneOrder(1)}>
        <span class="material-symbols-outlined" style="font-size:18px">arrow_downward</span>
        Move down
      </button>
    </div>

  </Collapsible>
{/if}
