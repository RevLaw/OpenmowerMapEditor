<script>
  import { onMount, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import MapCanvas from "./MapCanvas.svelte";
  import Sidebar from "./Sidebar.svelte";
  import ToolDock from "./ToolDock.svelte";
  import RobotHud from "./RobotHud.svelte";
  import ToolHint from "./ToolHint.svelte";
  import MapControls from "./MapControls.svelte";
  import BasemapControl from "./BasemapControl.svelte";
  import StatusToasts from "./StatusToasts.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import ShortcutCheatSheet from "./ShortcutCheatSheet.svelte";
  import BackupsModal from "./BackupsModal.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import SaveDialog from "./SaveDialog.svelte";
  import DraftBanner from "./DraftBanner.svelte";
  import SelectionBar from "./SelectionBar.svelte";
  import { backupsOpen, sidebarOpen, editMode } from "../lib/stores/ui.js";
  import SidebarRail from "./SidebarRail.svelte";
  import { initTeleopSafety } from "../lib/stores/teleop.js";
  import { get } from "svelte/store";
  import { bootstrap } from "../lib/actions.js";
  import { initRobotLifecycle } from "../lib/stores/robot.js";
  import { initWifiSurveyLifecycle } from "../lib/stores/wifi.js";
  import { initRobotTrailHistoryLifecycle } from "../lib/stores/robotTrail.js";
  import { isDirty } from "../lib/stores/dirty.js";
  import { initShortcuts } from "../lib/shortcuts.js";

  let paletteOpen = $state(false);
  let cheatOpen = $state(false);
  // Open by default on desktop; collapsed on small screens (toggle via FAB).
  const cleanups = [];

  // The right-side control (the edit tool dock, or just an "Edit" button in
  // view mode) normally floats vertically centered on the same right edge as
  // the robot HUD above it. The HUD's height varies (it has
  // its own collapse toggle, but can still be expanded), so instead of a
  // fixed cap, the two are coordinated live: as the HUD grows past the
  // centered dock's top edge, the dock is pushed down to make room; only if
  // it still doesn't fit does the HUD's own content start scrolling, as a
  // last resort.
  const EDGE_GAP = 12; // matches right-3 / top-3 (0.75rem)
  const ATTRIBUTION_ROOM = 24; // keep clear of the map attribution (bottom-right)

  let hudWrapEl = $state();
  let toolDockWrapEl = $state();

  let toolDockHeight = 0;
  let hudNaturalHeight = 0;

  let controlStackTop = $state(0);
  let robotHudMaxHeight = $state(null);

  // The sidebar's actual rendered width — it's pure CSS (w-[360px]
  // max-w-[calc(100vw-1.5rem)]), so this mirrors that formula rather than
  // adding a second ResizeObserver on a conditionally-mounted element.
  // BasemapControl needs this to sit flush against the sidebar's real edge
  // instead of assuming it's always exactly 360px wide.
  let sidebarWidth = $state(360);
  // Wide enough to put the selection bar beside the basemap button (else it
  // sits one row above it).
  let wide = $state(typeof window === "undefined" || window.innerWidth >= 900);
  const BASEMAP_BUTTON_ROOM = 180;

  function recomputeLayout() {
    sidebarWidth = Math.min(360, window.innerWidth - 24);
    wide = window.innerWidth >= 900;
    if (!toolDockWrapEl || !hudWrapEl) return;
    const vh = window.innerHeight;
    const hudBottom = EDGE_GAP + hudNaturalHeight;
    const maxStackBottom = vh - ATTRIBUTION_ROOM - EDGE_GAP;

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

    // 3) Last resort: bottom-aligned just above the attribution — that
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
    cleanups.push(initTeleopSafety());
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
      }
      recomputeLayout();
    });
    resizeObserver.observe(toolDockWrapEl);
    resizeObserver.observe(hudWrapEl);
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
  {#if $sidebarOpen}
    <div
      class="absolute bottom-3 left-3 top-3 z-30 w-[360px] max-w-[calc(100vw-1.5rem)]"
      transition:fly={{ x: -380, duration: 220 }}
    >
      <Sidebar
        onOpenPalette={() => (paletteOpen = true)}
        onClose={() => sidebarOpen.set(false)}
      />
    </div>
  {/if}

  <!-- FAB to reopen the sidebar (mobile / after closing) -->
  <!-- Folded sidebar: a slim icon rail (keeps the map free on phones) -->
  {#if !$sidebarOpen}
    <div class="absolute left-3 top-3 z-30">
      <SidebarRail />
    </div>
  {/if}

  <!-- Right side: the edit tool dock, or just an "Edit" button in view mode
       (the default on phones), coordinated with the robot HUD above it (see
       recomputeLayout) so neither ever overlaps the other. -->
  <div bind:this={toolDockWrapEl} class="absolute right-3 z-20" style="top:{controlStackTop}px">
    {#if $editMode}
      <ToolDock />
    {:else}
      <button
        class="glass flex flex-col items-center gap-0.5 rounded-2xl px-3 py-2 text-[11px] font-semibold text-accent"
        title="Edit the map (tools, vertex handles)"
        onclick={() => editMode.set(true)}
      >
        <span class="material-symbols-outlined" style="font-size:22px">edit</span>
        Edit
      </button>
    {/if}
  </div>

  <!-- Draft-restore banner + active-tool hint (top-center) -->
  <div class="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
    <div class="pointer-events-auto">
      <DraftBanner />
    </div>
    <div class="pointer-events-auto">
      <ToolHint />
    </div>
  </div>

  <!-- Quick actions for the selected zone (bottom-center) -->
  <div
    class="pointer-events-none absolute z-20 flex justify-center transition-all duration-200"
    style="bottom:{wide ? 12 : 60}px;left:{($sidebarOpen && wide ? sidebarWidth + EDGE_GAP + 4 : 12) +
      (wide ? BASEMAP_BUTTON_ROOM : 0)}px;right:64px"
  >
    <div class="pointer-events-auto max-w-full">
      {#if $editMode}<SelectionBar />{/if}
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

  <!-- Map view controls (follow robot, trail, zoom) stacked above the
       base-map switcher, bottom-left — clears the sidebar when open. -->
  <div
    class="absolute bottom-3 z-30 flex flex-col items-start gap-2 transition-all duration-200"
    style="left:{$sidebarOpen ? `${sidebarWidth + EDGE_GAP + 4}px` : '12px'}"
  >
    <MapControls />
    <BasemapControl />
  </div>

  <StatusToasts />
  <CommandPalette bind:open={paletteOpen} onCheat={() => (cheatOpen = true)} />
  <ShortcutCheatSheet bind:open={cheatOpen} />
  <BackupsModal bind:open={$backupsOpen} />
  <SaveDialog />
  <ContextMenu />
</div>
