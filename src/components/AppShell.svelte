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
  import { initRobotTrailHistoryLifecycle } from "../lib/stores/robotTrail.js";
  import { isDirty } from "../lib/stores/dirty.js";
  import { initShortcuts } from "../lib/shortcuts.js";

  let paletteOpen = false;
  let cheatOpen = false;
  // Open by default on desktop; collapsed on small screens (toggle via FAB).
  let sidebarOpen = typeof window === "undefined" || window.innerWidth >= 1024;
  const cleanups = [];

  // The mower-control + tool-dock stack normally floats vertically centered
  // on the same right edge as the robot HUD above it. The HUD's height varies
  // a lot (Live robot / WiFi / trail sections can all be expanded at once),
  // so instead of a fixed cap, the two are coordinated live: as the HUD grows
  // past the centered stack's top edge, the stack is pushed down to make
  // room; if it would then run off the bottom of the viewport, the stack
  // switches to two columns (mower control beside the tool dock instead of
  // above it, which is shorter); only if it still doesn't fit does the HUD's
  // own content start scrolling, as a last resort.
  const EDGE_GAP = 12; // matches right-3 / top-3 (0.75rem)
  const STACK_GAP = 8; // matches gap-2 (0.5rem) between mower control and the tool dock
  const ZOOM_BOTTOM_OFFSET = 28; // matches bottom-7 (1.75rem) on the zoom control

  let hudWrapEl;
  let mowerControlWrapEl;
  let toolDockWrapEl;
  let zoomControlWrapEl;

  let mowerControlHeight = 0;
  let toolDockHeight = 0;
  let hudNaturalHeight = 0;
  let zoomControlHeight = 0;

  let controlStackTop = 0;
  let useTwoColumnStack = false;
  let robotHudMaxHeight = null;

  function recomputeLayout() {
    if (!mowerControlWrapEl || !toolDockWrapEl || !hudWrapEl || !zoomControlWrapEl) return;
    const vh = window.innerHeight;
    const singleColHeight = mowerControlHeight + STACK_GAP + toolDockHeight;
    const twoColHeight = Math.max(mowerControlHeight, toolDockHeight);
    const hudBottom = EDGE_GAP + hudNaturalHeight;
    // The zoom buttons are independently pinned near the bottom-right; the
    // control stack must never be pushed low enough to reach them.
    const maxStackBottom = vh - ZOOM_BOTTOM_OFFSET - zoomControlHeight - EDGE_GAP;

    // 1) Original layout: stack centered, HUD shown in full.
    const centeredTop = (vh - singleColHeight) / 2;
    if (centeredTop >= hudBottom + EDGE_GAP && centeredTop + singleColHeight <= maxStackBottom) {
      controlStackTop = centeredTop;
      useTwoColumnStack = false;
      robotHudMaxHeight = null;
      return;
    }

    // 2) Push the stack down below the HUD, still one column.
    const pushedTop = hudBottom + EDGE_GAP;
    if (pushedTop + singleColHeight <= maxStackBottom) {
      controlStackTop = pushedTop;
      useTwoColumnStack = false;
      robotHudMaxHeight = null;
      return;
    }

    // 3) Pushed down, but shorten the stack by going to two columns.
    if (pushedTop + twoColHeight <= maxStackBottom) {
      controlStackTop = pushedTop;
      useTwoColumnStack = true;
      robotHudMaxHeight = null;
      return;
    }

    // 4) Last resort: two columns, bottom-aligned just above the zoom
    // buttons — that boundary is a hard requirement, so it's never clamped
    // back down to stay below the HUD. If the stack is taller than the
    // space that leaves, its own top edge (not the zoom buttons) is what
    // gives; the HUD still gets whatever room remains above it, if any.
    useTwoColumnStack = true;
    controlStackTop = maxStackBottom - twoColHeight;
    robotHudMaxHeight = Math.max(44, controlStackTop - EDGE_GAP * 2);
  }

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
    cleanups.push(initRobotTrailHistoryLifecycle());
    cleanups.push(
      initShortcuts({
        openPalette: () => (paletteOpen = true),
        toggleCheat: () => (cheatOpen = !cheatOpen),
      })
    );
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanups.push(() => window.removeEventListener("beforeunload", onBeforeUnload));

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (entry.target === mowerControlWrapEl) mowerControlHeight = height;
        else if (entry.target === toolDockWrapEl) toolDockHeight = height;
        else if (entry.target === hudWrapEl) hudNaturalHeight = height;
        else if (entry.target === zoomControlWrapEl) zoomControlHeight = height;
      }
      recomputeLayout();
    });
    resizeObserver.observe(mowerControlWrapEl);
    resizeObserver.observe(toolDockWrapEl);
    resizeObserver.observe(hudWrapEl);
    resizeObserver.observe(zoomControlWrapEl);
    window.addEventListener("resize", recomputeLayout);
    cleanups.push(() => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", recomputeLayout);
    });
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

  <!-- Right-side bars: mower control + tool dock, coordinated with the robot
       HUD above them (see recomputeLayout) so neither ever overlaps the other. -->
  <div
    class="absolute right-3 z-20 flex gap-2"
    class:flex-col={!useTwoColumnStack}
    class:items-end={!useTwoColumnStack}
    class:flex-row-reverse={useTwoColumnStack}
    class:items-start={useTwoColumnStack}
    style="top:{controlStackTop}px"
  >
    <div bind:this={mowerControlWrapEl}>
      <MowerControl />
    </div>
    <div bind:this={toolDockWrapEl}>
      <ToolDock />
    </div>
  </div>

  <!-- Active-tool hint (top-center) -->
  <div class="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
    <div class="pointer-events-auto">
      <ToolHint />
    </div>
  </div>

  <!-- Robot HUD (top-right) — the control stack below it gets pushed down (and
       reflowed to two columns) to make room first; only once that's exhausted
       does this start scrolling internally instead of overlapping it. -->
  <div
    class="absolute right-3 top-3 z-20 overflow-y-auto"
    style={robotHudMaxHeight ? `max-height:${robotHudMaxHeight}px` : ""}
  >
    <div bind:this={hudWrapEl}>
      <RobotHud />
    </div>
  </div>

  <!-- Zoom buttons (bottom-right, above the map attribution) — a fixed anchor
       the control stack above must never be pushed down far enough to reach. -->
  <div bind:this={zoomControlWrapEl} class="absolute bottom-7 right-3 z-20">
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
