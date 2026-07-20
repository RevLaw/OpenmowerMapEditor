<script>
  import MapSourcePanel from "./panels/MapSourcePanel.svelte";
  import ZonePanel from "./panels/ZonePanel.svelte";
  import CreatePanel from "./panels/CreatePanel.svelte";
  import ProjectionPanel from "./panels/ProjectionPanel.svelte";
  import ToolSettingsPanel from "./panels/ToolSettingsPanel.svelte";
  import TransformPanel from "./panels/TransformPanel.svelte";
  import MeasurementsPanel from "./panels/MeasurementsPanel.svelte";
  import CoveragePanel from "./panels/CoveragePanel.svelte";
  import ValidationPanel from "./panels/ValidationPanel.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { status } from "../lib/stores/toast.js";
  import { isDirty } from "../lib/stores/dirty.js";
  import { saveCurrent } from "../lib/actions.js";

  export let onOpenPalette = () => {};
  export let onClose = null;
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
      <button class="btn-icon" title="Command palette (Ctrl/Cmd + K)" on:click={onOpenPalette}>
        <span class="material-symbols-outlined" style="font-size:20px">bolt</span>
      </button>
      <ThemeToggle />
      {#if onClose}
        <button class="btn-icon lg:hidden" title="Close" on:click={onClose}>
          <span class="material-symbols-outlined" style="font-size:20px">close</span>
        </button>
      {/if}
    </div>
  </header>

  <div class="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
    <MapSourcePanel />
    <ProjectionPanel />
    <ZonePanel />
    <CoveragePanel />
    <TransformPanel />
    <ToolSettingsPanel />
    <CreatePanel />
    <MeasurementsPanel />
    <ValidationPanel />
  </div>

  <footer class="space-y-1.5 border-t p-2.5" style="border-color:var(--edge-soft)">
    <div class="grid gap-1.5">
      <button class="btn btn-accent" on:click={() => saveCurrent({ restart: false })}>
        <span class="material-symbols-outlined" style="font-size:18px">save</span>
        Save map.json
      </button>
      <button class="btn btn-warn" on:click={() => saveCurrent({ restart: true })}>
        <span class="material-symbols-outlined" style="font-size:18px">restart_alt</span>
        Save + restart ROS
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
