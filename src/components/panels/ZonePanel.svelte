<script>
  import Collapsible from "../Collapsible.svelte";
  import { currentArea, editor, areaList, setAreaIndex } from "../../lib/stores/editor.js";
  import { getAreaType, getZoneName } from "../../lib/format/mapFormat.js";
  import {
    changeZoneType,
    renameCurrentZone,
    moveZoneOrder,
    removeCurrentZone,
  } from "../../lib/actions.js";

  // Colored emoji type badge in the picker (🟩 mow · 🟥 obstacle · 🟦 nav).
  const TYPE_BADGE = { mow: "🟩", obstacle: "🟥", nav: "🟦" };
  const badge = (type) => TYPE_BADGE[type] || "⬜";

  let nameDraft = "";
  let editingName = false;

  $: area = $currentArea;
  $: type = getAreaType(area);
  $: index = $editor.areaIndex;
  $: count = $editor.mapData?.areas?.length ?? 0;
  $: currentName = area?.properties?.name?.trim() ?? "";
  // Keep the name field synced with the selected zone unless it's being edited.
  $: if (area && !editingName) nameDraft = currentName;

  function commitName() {
    editingName = false;
    // Only commit when the name actually changed (avoid a no-op undo entry).
    if (area && nameDraft.trim() !== currentName) {
      renameCurrentZone(nameDraft);
    }
  }
</script>

{#if area}
  <Collapsible title="Selected zone" icon="category" key="zone">
    <label class="field">
      Zone
      <select
        class="select"
        value={String(index)}
        on:change={(e) => setAreaIndex(Number(e.target.value))}
      >
        {#each $areaList as a}
          <option value={String(a.index)}>
            {badge(a.type)}
            {a.name || `${a.type} ${a.index + 1}`}
          </option>
        {/each}
      </select>
    </label>

    <label class="field">
      Type
      <select class="select" value={type} on:change={(e) => changeZoneType(e.target.value)}>
        <option value="mow">mow</option>
        <option value="obstacle">obstacle</option>
        <option value="nav">nav</option>
      </select>
    </label>

    <label class="field">
      Name
      <input
        class="input"
        placeholder={getZoneName(area, index)}
        bind:value={nameDraft}
        on:focus={() => (editingName = true)}
        on:blur={commitName}
        on:keydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
    <p class="mb-2 truncate text-[10px] text-subtle" title={area.id}>id: {area.id}</p>

    {#if type === "mow"}
      <p class="mb-2 text-[10px] text-subtle">
        Set this zone's cutting parameters in the <b>Mowing</b> panel below.
      </p>
    {/if}

    <div class="mb-2 grid grid-cols-2 gap-2">
      <button class="btn" disabled={index <= 0} on:click={() => moveZoneOrder(-1)}>
        <span class="material-symbols-outlined" style="font-size:18px">arrow_upward</span>
        Move up
      </button>
      <button class="btn" disabled={index >= count - 1} on:click={() => moveZoneOrder(1)}>
        <span class="material-symbols-outlined" style="font-size:18px">arrow_downward</span>
        Move down
      </button>
    </div>

    <button
      class="btn w-full"
      style="border-color:var(--danger);color:var(--danger)"
      on:click={removeCurrentZone}
    >
      <span class="material-symbols-outlined" style="font-size:18px">delete</span>
      Remove this zone
    </button>
  </Collapsible>
{/if}
