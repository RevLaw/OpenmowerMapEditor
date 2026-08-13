<script>
  import { onMount, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import MapCanvas from "./MapCanvas.svelte";
  import Sidebar from "./Sidebar.svelte";
  import ToolDock from "./ToolDock.svelte";
  import RobotHud from "./RobotHud.svelte";
  import ToolHint from "./ToolHint.svelte";
  import ZoomControl from "./ZoomControl.svelte";
  import BasemapControl from "./BasemapControl.svelte";
  import MowerControl from "./MowerControl.svelte";
  import StatusToasts from "./StatusToasts.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import ShortcutCheatSheet from "./ShortcutCheatSheet.svelte";
  import BackupsModal from "./BackupsModal.svelte";
  import { backupsOpen } from "../lib/stores/ui.js";
  import { get } from "svelte/store";
  import { bootstrap } from "../lib/actions.js";
  import { initRobotLifecycle } from "../lib/stores/robot.js";
  import { initWifiSurveyLifecycle } from "../lib/stores/wifi.js";
  import { isDirty } from "../lib/stores/dirty.js";
  import { initShortcuts } from "../lib/shortcuts.js";

  let paletteOpen = false;
  let cheatOpen = false;
  // Open by default on desktop; collapsed on small screens (toggle via FAB).
  let sidebarOpen = typeof window === "undefined" || window.innerWidth >= 1024;
  const cleanups = [];

  function onBeforeUnload(e) {
    if (get(isDirty)) {
      e.preventDefault();
      e.returnValue = "";
    }
  }

  onMount(() => {
    bootstrap();
    cleanups.push(initRobotLifecycle());
    cleanups.push(initWifiSurveyLifecycle());
    cleanups.push(
      initShortcuts({
        openPalette: () => (paletteOpen = true),
        toggleCheat: () => (cheatOpen = !cheatOpen),
      })
    );
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanups.push(() => window.removeEventListener("beforeunload", onBeforeUnload));
  });

  onDestroy(() => cleanups.forEach((fn) => fn && fn()));
</script>

<div class="relative h-[100dvh] w-screen overflow-hidden tech-grid" style="background:var(--bg)">
  <MapCanvas />

  <!-- Sidebar (left). Slides off-canvas when closed (mobile). -->
  {#if sidebarOpen}
    <div
      class="absolute bottom-3 left-3 top-3 z-30 w-[360px] max-w-[calc(100vw-1.5rem)]"
      transition:fly={{ x: -380, duration: 220 }}
    >
      <Sidebar
        onOpenPalette={() => (paletteOpen = true)}
        onClose={() => (sidebarOpen = false)}
      />
    </div>
  {/if}

  <!-- FAB to reopen the sidebar (mobile / after closing) -->
  {#if !sidebarOpen}
    <button
      class="glass absolute left-3 top-3 z-30 grid h-11 w-11 place-items-center rounded-xl"
      title="Open panel"
      on:click={() => (sidebarOpen = true)}
    >
      <span class="material-symbols-outlined text-accent" style="font-size:24px">tune</span>
    </button>
  {/if}

  <!-- Right-side bars (vertically centered): mower control above the tool dock -->
  <div class="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col items-end gap-2">
    <MowerControl />
    <ToolDock />
  </div>

  <!-- Active-tool hint (top-center) -->
  <div class="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
    <div class="pointer-events-auto">
      <ToolHint />
    </div>
  </div>

  <!-- Robot HUD (top-right) -->
  <div class="absolute right-3 top-3 z-20">
    <RobotHud />
  </div>

  <!-- Zoom buttons (bottom-right, above the map attribution) -->
  <div class="absolute bottom-7 right-3 z-20">
    <ZoomControl />
  </div>

  <!-- Base-map switcher (bottom-left, clears the sidebar when open) -->
  <div
    class="absolute bottom-3 z-30 transition-all duration-200"
    style="left:{sidebarOpen ? '376px' : '12px'}"
  >
    <BasemapControl />
  </div>

  <StatusToasts />
  <CommandPalette bind:open={paletteOpen} onCheat={() => (cheatOpen = true)} />
  <ShortcutCheatSheet bind:open={cheatOpen} />
  <BackupsModal bind:open={$backupsOpen} />
</div>
