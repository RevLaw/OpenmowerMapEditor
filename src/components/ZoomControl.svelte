<script>
  import { mapApi } from "../lib/stores/mapApi.js";
</script>

<div class="glass flex flex-col gap-0.5 rounded-xl p-1">
  <button
    class="btn-icon !h-9 !w-9"
    title="Zoom in"
    aria-label="Zoom in"
    on:click={() => $mapApi?.zoomIn()}
  >
    <span class="material-symbols-outlined" style="font-size:22px">add</span>
  </button>
  <div class="mx-1 h-px" style="background:var(--edge-soft)"></div>
  <button
    class="btn-icon !h-9 !w-9"
    title="Zoom out"
    aria-label="Zoom out"
    on:click={() => $mapApi?.zoomOut()}
  >
    <span class="material-symbols-outlined" style="font-size:22px">remove</span>
  </button>
</div>
