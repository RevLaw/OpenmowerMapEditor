<script>
  import { fade, scale } from "svelte/transition";
  import { getCommands } from "../lib/commands.js";

  export let open = false;

  const extra = [
    { title: "Open command palette", group: "General", shortcut: "Ctrl K" },
    { title: "Box-select points", group: "Tools", shortcut: "Shift drag" },
    { title: "Nudge selected point(s)", group: "Edit", shortcut: "Arrows" },
    { title: "Larger nudge", group: "Edit", shortcut: "Shift Arrows" },
  ];

  $: groups = buildGroups();

  function buildGroups() {
    const withKeys = getCommands()
      .filter((c) => c.shortcut)
      .map((c) => ({ title: c.title, group: c.group, shortcut: c.shortcut }))
      .concat(extra);
    const byGroup = {};
    for (const item of withKeys) {
      (byGroup[item.group] ||= []).push(item);
    }
    return Object.entries(byGroup);
  }

  function close() {
    open = false;
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4"
    on:click={close}
    transition:fade={{ duration: 120 }}
    role="presentation"
  >
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions a11y-no-noninteractive-element-interactions -->
    <div
      class="glass glass-strong w-full max-w-md overflow-hidden rounded-2xl"
      on:click|stopPropagation
      transition:scale={{ duration: 140, start: 0.97 }}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <header class="flex items-center justify-between border-b px-4 py-3" style="border-color:var(--edge-soft)">
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <span class="material-symbols-outlined" style="font-size:18px">keyboard</span>
          Keyboard shortcuts
        </h2>
        <button class="btn-icon" on:click={close} aria-label="Close">
          <span class="material-symbols-outlined" style="font-size:20px">close</span>
        </button>
      </header>

      <div class="scroll-thin max-h-[70vh] space-y-4 overflow-y-auto p-4">
        {#each groups as [group, items]}
          <div>
            <h3 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">{group}</h3>
            <ul class="space-y-1">
              {#each items as item}
                <li class="flex items-center justify-between text-sm">
                  <span class="text-muted">{item.title}</span>
                  <kbd class="chip">{item.shortcut}</kbd>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
