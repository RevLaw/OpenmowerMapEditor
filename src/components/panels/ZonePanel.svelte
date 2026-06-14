<script>
  import { currentArea, editor } from "../../lib/stores/editor.js";
  import { getAreaType } from "../../lib/format/mapFormat.js";
  import {
    changeZoneType,
    renameCurrentZone,
    moveZoneOrder,
    removeCurrentZone,
  } from "../../lib/actions.js";

  let idDraft = "";
  let editingId = false;

  $: area = $currentArea;
  $: type = getAreaType(area);
  $: index = $editor.areaIndex;
  $: count = $editor.mapData?.areas?.length ?? 0;
  // Keep the id field synced with the selected zone unless it's being edited.
  $: if (area && !editingId) idDraft = area.id ?? "";

  function commitId() {
    editingId = false;
    // Only commit when the id actually changed (avoid a no-op undo entry).
    if (area && idDraft.trim() && idDraft.trim() !== area.id) {
      renameCurrentZone(idDraft);
    }
  }
</script>

{#if area}
  <section class="card">
    <h2 class="card-title">
      <span class="material-symbols-outlined" style="font-size:16px">category</span>
      Selected zone
    </h2>

    <label class="field">
      Type
      <select class="select" value={type} on:change={(e) => changeZoneType(e.target.value)}>
        <option value="mow">mow</option>
        <option value="obstacle">obstacle</option>
        <option value="nav">nav</option>
      </select>
    </label>

    <label class="field">
      Zone id
      <input
        class="input"
        bind:value={idDraft}
        on:focus={() => (editingId = true)}
        on:blur={commitId}
        on:keydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>

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
  </section>
{/if}
