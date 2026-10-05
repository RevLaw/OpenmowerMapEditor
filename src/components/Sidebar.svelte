<script>
  import MapSourcePanel from "./panels/MapSourcePanel.svelte";
  import ZoneListPanel from "./panels/ZoneListPanel.svelte";
  import VertexPanel from "./panels/VertexPanel.svelte";
  import ShapeOpsPanel from "./panels/ShapeOpsPanel.svelte";
  import ProjectionPanel from "./panels/ProjectionPanel.svelte";
  import ToolSettingsPanel from "./panels/ToolSettingsPanel.svelte";
  import TransformPanel from "./panels/TransformPanel.svelte";
  import MeasurementsPanel from "./panels/MeasurementsPanel.svelte";
  import ValidationPanel from "./panels/ValidationPanel.svelte";
  import DockPanel from "./panels/DockPanel.svelte";
  import RecordPanel from "./panels/RecordPanel.svelte";
  import TrailZonePanel from "./panels/TrailZonePanel.svelte";
  import DrivePanel from "./panels/DrivePanel.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { status } from "../lib/stores/toast.js";
  import { isDirty } from "../lib/stores/dirty.js";
  import { sidebarTab } from "../lib/stores/ui.js";
  import { validationIssues } from "../lib/stores/validation.js";
  import { recording } from "../lib/stores/recorder.js";
  import { driveMode } from "../lib/stores/teleop.js";
  import { requestSave } from "../lib/actions.js";

  let { onOpenPalette = () => {}, onClose = null } = $props();

  // Three tabs instead of one long stack: what you edit (zones), map-level
  // setup that's touched rarely, and robot-assisted mapping.
  const TABS = [
    { id: "zones", label: "Zones", icon: "layers" },
    { id: "map", label: "Map", icon: "map" },
    { id: "robot", label: "Robot", icon: "smart_toy" },
  ];

  let errorCount = $derived($validationIssues.filter((i) => i.severity === "error").length);
  let issueCount = $derived($validationIssues.length);
</script>

<aside class="glass flex h-full w-full flex-col overflow-hidden rounded-2xl">
  <header
    class="flex items-center justify-between gap-2 border-b px-3 py-2"
    style="border-color:var(--edge-soft)"
  >
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined is-filled text-accent" style="font-size:24px">
        robot_2
      </span>
      <div>
        <h1 class="text-sm font-semibold leading-none">OpenMower</h1>
        <p class="mt-0.5 text-[10px] uppercase tracking-wider text-subtle">Map Editor</p>
      </div>
    </div>
    <div class="flex items-center gap-1">
      <button class="btn-icon" title="Command palette (Ctrl/Cmd + K)" onclick={onOpenPalette}>
        <span class="material-symbols-outlined" style="font-size:20px">bolt</span>
      </button>
      <ThemeToggle />
      {#if onClose}
        <button class="btn-icon" title="Fold panel (Ctrl+B)" aria-label="Fold panel" onclick={onClose}>
          <span class="material-symbols-outlined" style="font-size:20px">left_panel_close</span>
        </button>
      {/if}
    </div>
  </header>

  <div class="flex gap-1 border-b px-2.5 pt-2" style="border-color:var(--edge-soft)" role="tablist">
    {#each TABS as t}
      <button
        class="tab flex flex-1 items-center justify-center gap-1.5 rounded-t-lg px-2 py-1.5 text-xs font-semibold"
        class:active={$sidebarTab === t.id}
        role="tab"
        aria-selected={$sidebarTab === t.id}
        onclick={() => sidebarTab.set(t.id)}
      >
        <span class="material-symbols-outlined" style="font-size:17px">{t.icon}</span>
        {t.label}
        {#if t.id === "map" && issueCount}
          <span class="badge" style="background:{errorCount ? 'var(--danger)' : 'var(--warn)'}">{issueCount}</span>
        {/if}
        {#if t.id === "robot" && $recording.active}
          <span class="badge rec" title="Recording a boundary">REC</span>
        {:else if t.id === "robot" && $driveMode === "on"}
          <span class="badge rec" title="Drive mode on">DRIVE</span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2" role="tabpanel">
    {#if $sidebarTab === "zones"}
      <ZoneListPanel />
      <ToolSettingsPanel />
      <VertexPanel />
      <TransformPanel />
      <ShapeOpsPanel />
      <MeasurementsPanel />
    {:else if $sidebarTab === "map"}
      <MapSourcePanel />
      <ValidationPanel />
      <DockPanel />
      <ProjectionPanel />
    {:else}
      <DrivePanel />
      <RecordPanel />
      <TrailZonePanel />
    {/if}
  </div>

  <footer class="space-y-1.5 border-t p-2.5" style="border-color:var(--edge-soft)">
    <div class="grid grid-cols-2 gap-1.5">
      <button class="btn btn-accent" title="Save map.json (Ctrl+S)" onclick={() => requestSave({ restart: false })}>
        <span class="material-symbols-outlined" style="font-size:18px">save</span>
        Save
      </button>
      <button class="btn btn-warn" title="Save map.json, then restart ROS so the robot loads it" onclick={() => requestSave({ restart: true })}>
        <span class="material-symbols-outlined" style="font-size:18px">restart_alt</span>
        Save + restart
      </button>
    </div>
    <div class="flex items-center gap-2">
      {#if $isDirty}
        <span class="chip shrink-0" style="color:var(--warn);border-color:var(--warn)">● Unsaved</span>
      {/if}
      <p class="truncate text-[11px] text-subtle" title={$status}>{$status}</p>
    </div>
  </footer>
</aside>

<style>
  .tab {
    color: var(--subtle);
    border: 1px solid transparent;
    border-bottom: none;
    margin-bottom: -1px;
  }
  .tab:hover {
    color: var(--ink);
  }
  .tab.active {
    color: var(--ink);
    background: var(--surface);
    border-color: var(--edge-soft);
  }
  .tab.active .material-symbols-outlined {
    color: var(--accent);
  }
  .badge {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 999px;
    font-size: 9px;
    line-height: 15px;
    color: #04121f;
    font-weight: 700;
  }
  .badge.rec {
    background: var(--danger);
    color: #fff;
  }
  @media (pointer: coarse) {
    .tab {
      min-height: 44px;
    }
  }
</style>
