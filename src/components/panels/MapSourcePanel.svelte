<script>
  import { areaList, editor, setAreaIndex } from "../../lib/stores/editor.js";
  import { loadFromFile } from "../../lib/actions.js";
  import { backupsOpen } from "../../lib/stores/ui.js";

  // Native <option>s can't hold styled HTML, so a colored emoji acts as the
  // type badge (🟩 mow · 🟥 obstacle · 🟦 nav).
  const TYPE_BADGE = { mow: "🟩", obstacle: "🟥", nav: "🟦" };
  const badge = (type) => TYPE_BADGE[type] || "⬜";

  function onFile(e) {
    const file = e.target.files?.[0];
    if (file) loadFromFile(file);
    e.target.value = "";
  }

  $: areaIndex = $editor.areaIndex;
</script>

<section class="card">
  <h2 class="card-title">
    <span class="material-symbols-outlined" style="font-size:16px">map</span>
    Map source
  </h2>

  <div class="mb-3 grid grid-cols-2 gap-2">
    <button class="btn" on:click={() => backupsOpen.set(true)}>
      <span class="material-symbols-outlined" style="font-size:18px">history</span>
      Backups…
    </button>
    <label class="btn cursor-pointer">
      <span class="material-symbols-outlined" style="font-size:18px">upload_file</span>
      Upload file
      <input type="file" accept=".json,application/json" class="hidden" on:change={onFile} />
    </label>
  </div>

  {#if $areaList.length}
    <label class="field !mb-0">
      Selected zone
      <select
        class="select"
        value={String(areaIndex)}
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
  {/if}
</section>
