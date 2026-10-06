<script>
  import { fade, scale } from "svelte/transition";
  import { getCommands } from "../lib/commands.js";

  let { open = $bindable(false) } = $props();

  const extra = [
    { title: "Open command palette", group: "General", shortcut: "Ctrl K" },
    { title: "Box-select points", group: "Tools", shortcut: "Shift drag" },
    { title: "Add / remove point from selection", group: "Tools", shortcut: "Shift click" },
    { title: "Nudge selected point(s)", group: "Edit", shortcut: "Arrows" },
    { title: "Larger nudge", group: "Edit", shortcut: "Shift Arrows" },
    { title: "Bypass snapping while dragging", group: "Tools", shortcut: "Alt" },
    { title: "Finish polygon", group: "Create", shortcut: "Enter / dbl-click" },
    { title: "Remove last polygon / ruler point", group: "Create", shortcut: "Backspace" },
    { title: "Context menu (zone, vertex, dock, map)", group: "General", shortcut: "Right-click / long-press" },
  ];

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

  const groups = buildGroups();

  function close() {
    open = false;
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4"
    onclick={close}
    transition:fade={{ duration: 120 }}
    role="presentation"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
    <div
      class="glass glass-strong w-full max-w-md overflow-hidden rounded-2xl"
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 140, start: 0.97 }}
      role="dialog"
      tabindex="-1"
      aria-label="Keyboard shortcuts"
    >
      <header class="flex items-center justify-between border-b px-4 py-3" style="border-color:var(--edge-soft)">
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <span class="material-symbols-outlined" style="font-size:18px">keyboard</span>
          Keyboard shortcuts
        </h2>
        <button class="btn-icon" onclick={close} aria-label="Close">
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
