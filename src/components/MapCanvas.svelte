<script>
  import { onMount, onDestroy } from "svelte";
  import { createMapController } from "../map/mapController.js";
  import { mapApi } from "../lib/stores/mapApi.js";

  let el;
  let controller;

  onMount(() => {
    controller = createMapController(el);
    mapApi.set(controller);
    const ro = new ResizeObserver(() => controller.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    controller?.destroy();
    mapApi.set(null);
  });
</script>

<div bind:this={el} class="absolute inset-0 z-0"></div>
