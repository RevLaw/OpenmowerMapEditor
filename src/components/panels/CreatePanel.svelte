<script>
  import { activeTool, toggleTool, drawZoneType } from "../../lib/stores/tools.js";
  import { addZoneAtCenter, duplicateZoneAction } from "../../lib/actions.js";

  const drawTools = [
    { id: "rect", icon: "crop_square", label: "Rectangle", hint: "drag on map" },
    { id: "circle", icon: "circle", label: "Circle", hint: "drag radius" },
    { id: "dock", icon: "ev_station", label: "Place dock", hint: "click map" },
  ];
</script>

<section class="card">
  <h2 class="card-title">
    <span class="material-symbols-outlined" style="font-size:16px">add_box</span>
    Create zone
  </h2>

  <label class="field">
    Zone type
    <select class="select" bind:value={$drawZoneType}>
      <option value="mow">mow</option>
      <option value="obstacle">obstacle</option>
      <option value="nav">nav</option>
    </select>
  </label>

  <button class="btn mb-2 w-full" on:click={() => addZoneAtCenter($drawZoneType)}>
    <span class="material-symbols-outlined" style="font-size:18px">add_circle</span>
    Add zone (square at center)
  </button>

  <p class="mb-1 text-[10px] uppercase tracking-wider text-subtle">…or draw on the map</p>
  <div class="grid grid-cols-3 gap-2">
    {#each drawTools as t}
      <button
        class="flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium transition-colors"
        style="background:{$activeTool === t.id
          ? 'var(--accent)'
          : 'var(--surface-2)'};color:{$activeTool === t.id ? '#04121f' : 'var(--ink)'}"
        title={`${t.label} — ${t.hint}`}
        on:click={() => toggleTool(t.id)}
      >
        <span class="material-symbols-outlined" style="font-size:20px">{t.icon}</span>
        {t.label}
      </button>
    {/each}
  </div>

  <button class="btn mt-3 w-full" on:click={duplicateZoneAction}>
    <span class="material-symbols-outlined" style="font-size:18px">content_copy</span>
    Duplicate selected zone
  </button>
</section>
