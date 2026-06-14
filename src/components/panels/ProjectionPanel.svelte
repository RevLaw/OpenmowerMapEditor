<script>
  import { editor } from "../../lib/stores/editor.js";
  import { applyProjection } from "../../lib/actions.js";

  let lat = 52.52;
  let lng = 13.405;
  let dirty = false;

  // Mirror the store origin until the user starts editing the fields.
  $: if (!dirty) {
    lat = $editor.origin.lat;
    lng = $editor.origin.lng;
  }

  function apply() {
    applyProjection(Number(lat), Number(lng));
    dirty = false;
  }
</script>

<section class="card">
  <h2 class="card-title">
    <span class="material-symbols-outlined" style="font-size:16px">explore</span>
    Projection
  </h2>
  <p class="mb-2 text-[10px] text-subtle">
    From <code class="text-muted">openmower config ros</code>: <code class="text-muted">datum_lat</code> /
    <code class="text-muted">datum_long</code>.
  </p>

  <div class="grid grid-cols-2 gap-2">
    <label class="field !mb-0">
      Latitude
      <input
        class="input"
        type="number"
        step="0.000001"
        bind:value={lat}
        on:input={() => (dirty = true)}
      />
    </label>
    <label class="field !mb-0">
      Longitude
      <input
        class="input"
        type="number"
        step="0.000001"
        bind:value={lng}
        on:input={() => (dirty = true)}
      />
    </label>
  </div>

  <button class="btn mt-2 w-full" on:click={apply}>
    <span class="material-symbols-outlined" style="font-size:18px">my_location</span>
    Apply projection
  </button>
</section>
