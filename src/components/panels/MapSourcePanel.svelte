<script>
  import { loadFromFile, importExchangeFile, exportMap } from "../../lib/actions.js";
  import { backupsOpen } from "../../lib/stores/ui.js";
  import { editor } from "../../lib/stores/editor.js";
  import Collapsible from "../Collapsible.svelte";

  let importType = $state("mow");

  function onFile(e) {
    const file = e.target.files?.[0];
    if (file) loadFromFile(file);
    e.target.value = "";
  }

  function onImport(e) {
    const file = e.target.files?.[0];
    if (file) importExchangeFile(file, { defaultType: importType });
    e.target.value = "";
  }

  let noMap = $derived(!$editor.mapData);
</script>

<Collapsible title="File" icon="folder_open" key="source">
  <div class="grid grid-cols-2 gap-2">
    <button class="btn" onclick={() => backupsOpen.set(true)}>
      <span class="material-symbols-outlined" style="font-size:18px">history</span>
      Backups…
    </button>
    <label class="btn cursor-pointer" title="Open a map.json file (replaces the current map)">
      <span class="material-symbols-outlined" style="font-size:18px">upload_file</span>
      Open JSON
      <input type="file" accept=".json,application/json" class="hidden" onchange={onFile} />
    </label>
  </div>

  <div class="mt-3 border-t pt-2" style="border-color:var(--edge-soft)">
    <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">GeoJSON / KML</p>
    <p class="mb-2 text-[10px] text-subtle">
      Trace in QGIS or Google Earth, or keep an off-robot copy. Uses the current projection origin.
    </p>
    <div class="mb-2 flex items-center gap-2">
      <label
        class="btn flex-1 cursor-pointer"
        class:opacity-50={noMap}
        title="Add polygons from a .geojson / .kml file to this map"
      >
        <span class="material-symbols-outlined" style="font-size:18px">add_location_alt</span>
        Import…
        <input type="file" accept=".geojson,.json,.kml,application/geo+json,application/vnd.google-earth.kml+xml" class="hidden" disabled={noMap} onchange={onImport} />
      </label>
      <select class="select !mt-0 !w-auto" bind:value={importType} title="Zone type for polygons without one">
        <option value="mow">as mow</option>
        <option value="obstacle">as obstacle</option>
        <option value="nav">as nav</option>
      </select>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <button class="btn !px-2 text-xs" disabled={noMap} onclick={() => exportMap("geojson")}>
        <span class="material-symbols-outlined" style="font-size:17px">download</span>
        GeoJSON
      </button>
      <button class="btn !px-2 text-xs" disabled={noMap} onclick={() => exportMap("kml")}>
        <span class="material-symbols-outlined" style="font-size:17px">download</span>
        KML
      </button>
    </div>
  </div>
</Collapsible>
