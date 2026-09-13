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

  // The control dock (mower control + edit tools, merged into one panel —
  // see ToolDock.svelte) normally floats vertically centered on the same
  // right edge as the robot HUD above it. The HUD's height varies (it has
  // its own collapse toggle, but can still be expanded), so instead of a
  // fixed cap, the two are coordinated live: as the HUD grows past the
  // centered dock's top edge, the dock is pushed down to make room; only if
  // it still doesn't fit does the HUD's own content start scrolling, as a
  // last resort.
  const EDGE_GAP = 12; // matches right-3 / top-3 (0.75rem)
  const ZOOM_BOTTOM_OFFSET = 28; // matches bottom-7 (1.75rem) on the zoom control

  let hudWrapEl;
  let toolDockWrapEl;
  let zoomControlWrapEl;

  let toolDockHeight = 0;
  let hudNaturalHeight = 0;
  let zoomControlHeight = 0;

  let controlStackTop = 0;
  let robotHudMaxHeight = null;

  // The sidebar's actual rendered width — it's pure CSS (w-[360px]
  // max-w-[calc(100vw-1.5rem)]), so this mirrors that formula rather than
  // adding a second ResizeObserver on a conditionally-mounted element.
  // BasemapControl needs this to sit flush against the sidebar's real edge
  // instead of assuming it's always exactly 360px wide.
  let sidebarWidth = 360;

  function recomputeLayout() {
    sidebarWidth = Math.min(360, window.innerWidth - 24);
    if (!toolDockWrapEl || !hudWrapEl || !zoomControlWrapEl) return;
    const vh = window.innerHeight;
    const hudBottom = EDGE_GAP + hudNaturalHeight;
    // The zoom buttons are independently pinned near the bottom-right; the
    // control dock must never be pushed low enough to reach them.
    const maxStackBottom = vh - ZOOM_BOTTOM_OFFSET - zoomControlHeight - EDGE_GAP;

    // 1) Original layout: dock centered, HUD shown in full.
    const centeredTop = (vh - toolDockHeight) / 2;
    if (centeredTop >= hudBottom + EDGE_GAP && centeredTop + toolDockHeight <= maxStackBottom) {
      controlStackTop = centeredTop;
      robotHudMaxHeight = null;
      return;
    }

    // 2) Push the dock down below the HUD.
    const pushedTop = hudBottom + EDGE_GAP;
    if (pushedTop + toolDockHeight <= maxStackBottom) {
      controlStackTop = pushedTop;
      robotHudMaxHeight = null;
      return;
    }

    // 3) Last resort: bottom-aligned just above the zoom buttons — that
    // boundary is a hard requirement, so it's never clamped back down to
    // stay below the HUD. The HUD still gets whatever room remains above
    // it, if any (its own collapse toggle handles the common case).
    controlStackTop = maxStackBottom - toolDockHeight;
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
        if (entry.target === toolDockWrapEl) toolDockHeight = height;
        else if (entry.target === hudWrapEl) hudNaturalHeight = height;
        else if (entry.target === zoomControlWrapEl) zoomControlHeight = height;
      }
      recomputeLayout();
    });
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

  <!-- Right-side control dock: mower control + edit tools merged into one
       panel (see ToolDock.svelte), coordinated with the robot HUD above it
       (see recomputeLayout) so neither ever overlaps the other. -->
  <div bind:this={toolDockWrapEl} class="absolute right-3 z-20" style="top:{controlStackTop}px">
    <ToolDock />
  </div>

  <!-- Active-tool hint (top-center) -->
  <div class="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
    <div class="pointer-events-auto">
      <ToolHint />
    </div>
  </div>

  <!-- Robot HUD (top-right) — the control dock below it gets pushed down to
       make room first; only once that's exhausted does this start scrolling
       internally instead of overlapping it. -->
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
    style="left:{sidebarOpen ? `${sidebarWidth + EDGE_GAP + 4}px` : '12px'}"
  >
    <BasemapControl />
  </div>

  <StatusToasts />
  <CommandPalette bind:open={paletteOpen} onCheat={() => (cheatOpen = true)} />
  <ShortcutCheatSheet bind:open={cheatOpen} />
  <BackupsModal bind:open={$backupsOpen} />
</div>
