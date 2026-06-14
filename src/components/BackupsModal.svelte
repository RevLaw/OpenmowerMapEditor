<script>
  import { get } from "svelte/store";
  import { fade, scale } from "svelte/transition";
  import { backups, refreshBackups, loadBackup } from "../lib/actions.js";
  import { editor } from "../lib/stores/editor.js";
  import { parseMap } from "../lib/format/mapFormat.js";
  import { fetchBackup } from "../lib/api.js";
  import { mapSummary, parseBackupDate, relativeTime } from "../lib/summary.js";
  import { formatArea } from "../lib/measurements.js";
  import MiniMap from "./MiniMap.svelte";

  export let open = false;

  let items = [];
  let loading = false;
  let wasOpen = false;

  $: current = mapSummary($editor.mapData || { areas: [] });
  $: if (open && !wasOpen) {
    wasOpen = true;
    load();
  }
  $: if (!open && wasOpen) wasOpen = false;

  async function load() {
    loading = true;
    items = [];
    await refreshBackups();
    const names = get(backups);
    items = await Promise.all(
      names.map(async (name) => {
        try {
          const map = parseMap(await fetchBackup(name));
          return { name, map, summary: mapSummary(map), error: false };
        } catch (_e) {
          return { name, error: true };
        }
      })
    );
    loading = false;
  }

  function title(name) {
    if (name === "map.json") return "Running map";
    const d = parseBackupDate(name);
    return d ? d.toLocaleString() : name;
  }
  function subtitle(name) {
    if (name === "map.json") return "currently active on the robot";
    const d = parseBackupDate(name);
    return d ? relativeTime(d) : "backup";
  }

  const signed = (n) => (n > 0 ? "+" : "−") + Math.abs(n);

  function deltas(s) {
    const out = [];
    const dz = s.zones - current.zones;
    const dp = s.points - current.points;
    const da = s.mowArea - current.mowArea;
    if (dz) out.push({ text: `${signed(dz)} zone${Math.abs(dz) !== 1 ? "s" : ""}`, pos: dz > 0 });
    if (dp) out.push({ text: `${signed(dp)} pts`, pos: dp > 0 });
    if (Math.abs(da) >= 0.05)
      out.push({ text: `${da > 0 ? "+" : "−"}${formatArea(Math.abs(da))}`, pos: da > 0 });
    if (!out.length) out.push({ text: "identical to current", pos: null });
    return out;
  }
  const deltaColor = (p) => (p == null ? "var(--subtle)" : p ? "var(--ok)" : "var(--warn)");

  function choose(name) {
    loadBackup(name);
    open = false;
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[90] flex bg-black/60 p-3"
    on:click={() => (open = false)}
    transition:fade={{ duration: 120 }}
    role="presentation"
  >
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions a11y-no-noninteractive-element-interactions -->
    <div
      class="glass glass-strong flex h-full w-full flex-col overflow-hidden rounded-2xl"
      on:click|stopPropagation
      transition:scale={{ duration: 140, start: 0.98 }}
      role="dialog"
      aria-label="Load map or backup"
    >
      <header class="flex items-center justify-between border-b px-4 py-3" style="border-color:var(--edge-soft)">
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <span class="material-symbols-outlined" style="font-size:18px">history</span>
          Load map / backup
        </h2>
        <button class="btn-icon" on:click={() => (open = false)} aria-label="Close">
          <span class="material-symbols-outlined" style="font-size:20px">close</span>
        </button>
      </header>

      <div
        class="scroll-thin grid auto-rows-min gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {#if loading}
          <p class="col-span-full py-8 text-center text-sm text-subtle">Loading backups…</p>
        {:else if items.length === 0}
          <p class="col-span-full py-8 text-center text-sm text-subtle">No map files found.</p>
        {:else}
          {#each items as item (item.name)}
            <div class="card flex gap-3">
              {#if item.error}
                <div class="grid h-24 w-24 shrink-0 place-items-center rounded-lg text-[10px] text-danger" style="background:#0a111e">
                  unreadable
                </div>
              {:else}
                <MiniMap map={item.map} size={96} />
              {/if}
              <div class="flex min-w-0 flex-1 flex-col">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm font-semibold">{title(item.name)}</span>
                  {#if item.name === "map.json"}
                    <span class="chip shrink-0" style="color:var(--ok)">active</span>
                  {/if}
                </div>
                <span class="text-[11px] text-subtle">{subtitle(item.name)}</span>

                {#if !item.error}
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span class="chip">{item.summary.zones} zones</span>
                    <span class="chip">{item.summary.points} pts</span>
                    <span class="chip">{formatArea(item.summary.mowArea)}</span>
                  </div>
                  <div class="mt-1 flex flex-wrap gap-1">
                    {#each deltas(item.summary) as d}
                      <span class="chip" style="color:{deltaColor(d.pos)}">{d.text}</span>
                    {/each}
                  </div>
                {/if}

                <button class="btn mt-auto w-full !py-1.5 text-xs" on:click={() => choose(item.name)}>
                  <span class="material-symbols-outlined" style="font-size:16px">download</span>
                  Load this version
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <footer class="border-t px-4 py-2 text-[11px] text-subtle" style="border-color:var(--edge-soft)">
        Loading a version doesn't overwrite anything — save afterwards to make it the active map.json.
      </footer>
    </div>
  </div>
{/if}
