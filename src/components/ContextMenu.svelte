<script>
  import { tick } from "svelte";
  import { fade } from "svelte/transition";
  import { contextMenu } from "../lib/stores/ui.js";

  let menuEl = $state();
  let pos = $state({ left: 0, top: 0 });

  // Keep the menu fully on-screen (flip left/up near the right/bottom edge).
  $effect(() => {
    const m = $contextMenu;
    if (!m) return;
    pos = { left: m.x, top: m.y };
    tick().then(() => {
      if (!menuEl) return;
      const r = menuEl.getBoundingClientRect();
      const pad = 8;
      pos = {
        left: Math.max(pad, Math.min(m.x, window.innerWidth - r.width - pad)),
        top: Math.max(pad, m.y + r.height > window.innerHeight - pad ? m.y - r.height : m.y),
      };
      menuEl.querySelector("button:not(:disabled)")?.focus();
    });
  });

  function close() {
    contextMenu.set(null);
  }

  function run(item) {
    if (item.disabled) return;
    close();
    item.run();
  }

  function onKey(e) {
    if (!$contextMenu) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(menuEl?.querySelectorAll("button:not(:disabled)") || [])];
    const i = buttons.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<svelte:window onkeydowncapture={onKey} onresize={close} />

{#if $contextMenu}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[85]"
    onclick={close}
    oncontextmenu={(e) => {
      e.preventDefault();
      close();
    }}
  ></div>
  <div
    bind:this={menuEl}
    class="glass glass-strong fixed z-[86] min-w-[210px] max-w-[280px] rounded-xl p-1"
    style="left:{pos.left}px;top:{pos.top}px"
    role="menu"
    transition:fade={{ duration: 90 }}
  >
    {#if $contextMenu.title}
      <div class="truncate px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
        {$contextMenu.title}
      </div>
    {/if}
    {#each $contextMenu.items as item}
      {#if item === "divider"}
        <div class="my-1 h-px" style="background:var(--edge-soft)"></div>
      {:else}
        <button
          class="menu-item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm"
          class:danger={item.danger}
          role="menuitem"
          disabled={item.disabled}
          onclick={() => run(item)}
        >
          <span class="material-symbols-outlined" style="font-size:18px">{item.icon}</span>
          <span class="flex-1">{item.label}</span>
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu-item {
    color: var(--ink);
  }
  .menu-item:hover:not(:disabled),
  .menu-item:focus-visible {
    background: var(--surface-3);
    outline: none;
  }
  .menu-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .menu-item .material-symbols-outlined {
    color: var(--muted);
  }
  .menu-item.danger,
  .menu-item.danger .material-symbols-outlined {
    color: var(--danger);
  }
  @media (pointer: coarse) {
    .menu-item {
      min-height: 44px;
    }
  }
</style>
