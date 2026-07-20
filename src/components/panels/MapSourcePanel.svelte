<script>
  import { loadFromFile } from "../../lib/actions.js";
  import { backupsOpen } from "../../lib/stores/ui.js";
  import Collapsible from "../Collapsible.svelte";

  function onFile(e) {
    const file = e.target.files?.[0];
    if (file) loadFromFile(file);
    e.target.value = "";
  }
</script>

<Collapsible title="Map source" icon="map" key="source">
  <div class="grid grid-cols-2 gap-2">
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
</Collapsible>
