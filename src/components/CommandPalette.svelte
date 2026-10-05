<script>
  import { fade, scale } from "svelte/transition";
  import { tick, untrack } from "svelte";
  import { getCommands } from "../lib/commands.js";

  let { open = $bindable(false), onCheat = () => {} } = $props();

  let query = $state("");
  let selected = $state(0);
  let inputEl = $state();
  let listEl = $state();

  const all = getCommands({
    openCheatSheet: () => {
      close();
      onCheat();
    },
  });
  let filtered = $derived(filterCommands(all, query));

  // Keep the highlighted row inside the list as the filter narrows it.
  $effect.pre(() => {
    if (selected >= filtered.length) selected = Math.max(0, filtered.length - 1);
  });

  // Fresh query + focus each time the palette opens.
  $effect.pre(() => {
    if (open) untrack(reset);
  });

  function filterCommands(list, q) {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((c) => `${c.title} ${c.group}`.toLowerCase().includes(s));
  }

  async function reset() {
    query = "";
    selected = 0;
    await tick();
    inputEl?.focus();
  }

  function close() {
    open = false;
  }

  function run(cmd) {
    close();
    cmd.run();
  }

  async function scrollSelectedIntoView() {
    await tick();
    listEl?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(selected + 1, filtered.length - 1);
      scrollSelectedIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      scrollSelectedIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selected];
      if (cmd) run(cmd);
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
    onclick={close}
    onkeydown={onKey}
    transition:fade={{ duration: 120 }}
    role="presentation"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
    <div
      class="glass glass-strong w-full max-w-lg overflow-hidden rounded-2xl"
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 140, start: 0.97 }}
      role="dialog"
      tabindex="-1"
      aria-label="Command palette"
    >
      <div class="flex items-center gap-2 border-b px-3.5 py-2.5" style="border-color:var(--edge-soft)">
        <span class="material-symbols-outlined text-subtle" style="font-size:20px">bolt</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:this={inputEl}
          bind:value={query}
          onkeydown={onKey}
          autofocus
          class="w-full bg-transparent text-sm outline-none placeholder:text-subtle"
          placeholder="Type a command…"
        />
        <kbd class="chip">Esc</kbd>
      </div>

      <div bind:this={listEl} class="scroll-thin max-h-[50vh] overflow-y-auto p-1.5">
        {#if filtered.length === 0}
          <p class="px-3 py-6 text-center text-sm text-subtle">No matching commands.</p>
        {:else}
          {#each filtered as cmd, i (cmd.id)}
            <button
              data-selected={i === selected}
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors"
              style={i === selected ? "background:var(--surface-3)" : ""}
              onmouseenter={() => (selected = i)}
              onclick={() => run(cmd)}
            >
              <span class="material-symbols-outlined text-muted" style="font-size:18px">{cmd.icon}</span>
              <span class="flex-1">{cmd.title}</span>
              <span class="text-[10px] uppercase tracking-wide text-subtle">{cmd.group}</span>
              {#if cmd.shortcut}<kbd class="chip">{cmd.shortcut}</kbd>{/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
