<script>
  import { fly } from "svelte/transition";
  import { sidebarOpen, openSidebarTab } from "../lib/stores/ui.js";
  import { validationIssues } from "../lib/stores/validation.js";
  import { recording } from "../lib/stores/recorder.js";
  import { driveMode } from "../lib/stores/teleop.js";
  import { isDirty } from "../lib/stores/dirty.js";
  import { requestSave } from "../lib/actions.js";

  // The folded sidebar: a slim icon rail, so phones keep the map. Each tab
  // icon unfolds the sidebar on that tab.
  const TABS = [
    { id: "zones", icon: "layers", label: "Zones" },
    { id: "map", icon: "map", label: "Map" },
    { id: "robot", icon: "smart_toy", label: "Robot" },
  ];

  let issues = $derived($validationIssues.length);
  let errors = $derived($validationIssues.some((i) => i.severity === "error"));
  let robotBusy = $derived($recording.active || $driveMode === "on");
</script>

<div class="glass flex flex-col gap-1 rounded-2xl p-1" transition:fly={{ x: -20, duration: 160 }}>
  <button class="btn-icon rail-btn" title="Unfold panel (Ctrl+B)" aria-label="Unfold panel" onclick={() => sidebarOpen.set(true)}>
    <span class="material-symbols-outlined text-accent" style="font-size:22px">left_panel_open</span>
  </button>
  <div class="mx-1.5 h-px" style="background:var(--edge-soft)"></div>
  {#each TABS as t}
    <button class="btn-icon rail-btn relative" title={t.label} aria-label={t.label} onclick={() => openSidebarTab(t.id)}>
      <span class="material-symbols-outlined" style="font-size:21px">{t.icon}</span>
      {#if t.id === "map" && issues}
        <span class="dot" style="background:{errors ? 'var(--danger)' : 'var(--warn)'}"></span>
      {/if}
      {#if t.id === "robot" && robotBusy}
        <span class="dot" style="background:var(--danger)"></span>
      {/if}
    </button>
  {/each}
  <div class="mx-1.5 h-px" style="background:var(--edge-soft)"></div>
  <button class="btn-icon rail-btn relative" title="Save map.json (Ctrl+S)" aria-label="Save" onclick={() => requestSave({ restart: false })}>
    <span class="material-symbols-outlined" style="font-size:21px;{$isDirty ? 'color:var(--warn)' : ''}">save</span>
    {#if $isDirty}<span class="dot" style="background:var(--warn)"></span>{/if}
  </button>
</div>

<style>
  .rail-btn {
    width: 40px;
    height: 40px;
  }
  .dot {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--glass-strong);
  }
</style>
