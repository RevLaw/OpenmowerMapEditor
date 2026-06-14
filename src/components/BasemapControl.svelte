<script>
  import { fly } from "svelte/transition";
  import { BASEMAPS, basemapId, customBasemap } from "../lib/stores/basemap.js";

  let open = false;
  $: current = BASEMAPS.find((b) => b.id === $basemapId);
  $: label = $basemapId === "custom" ? "Custom" : (current?.label ?? "Base map");
</script>

<div class="relative">
  {#if open}
    <div
      transition:fly={{ y: 10, duration: 160 }}
      class="glass absolute bottom-12 left-0 w-72 rounded-2xl p-2"
    >
      <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-subtle">
        Base map
      </div>
      {#each BASEMAPS as b}
        <label
          class="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-2)]"
        >
          <input
            type="radio"
            bind:group={$basemapId}
            value={b.id}
            class="mt-0.5 accent-[var(--accent)]"
          />
          <span class="flex-1">
            <span class="block text-sm">{b.label}</span>
            <span class="block text-[10px] text-subtle">{b.note}</span>
          </span>
        </label>
      {/each}

      <label
        class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-2)]"
      >
        <input type="radio" bind:group={$basemapId} value="custom" class="accent-[var(--accent)]" />
        <span class="text-sm">Custom…</span>
      </label>

      {#if $basemapId === "custom"}
        <div class="mt-1 space-y-2 border-t pt-2" style="border-color:var(--edge-soft)">
          <select class="select" bind:value={$customBasemap.type}>
            <option value="xyz">XYZ tiles</option>
            <option value="wms">WMS</option>
          </select>
          <input
            class="input"
            placeholder={$customBasemap.type === "wms"
              ? "WMS base URL"
              : "https://…/{z}/{x}/{y}.png"}
            bind:value={$customBasemap.url}
          />
          {#if $customBasemap.type === "wms"}
            <input class="input" placeholder="WMS layer name" bind:value={$customBasemap.layers} />
          {/if}
          <input class="input" placeholder="Attribution" bind:value={$customBasemap.attribution} />
        </div>
      {/if}
    </div>
  {/if}

  <button
    class="glass flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium"
    on:click={() => (open = !open)}
    title="Base map"
  >
    <span class="material-symbols-outlined text-accent" style="font-size:18px">layers</span>
    {label}
  </button>
</div>
