<script>
  import { fade, slide } from "svelte/transition";
  import {
    robotLive,
    robotReadout,
    robotPose,
    toggleRobotLive,
  } from "../lib/stores/robot.js";
  import {
    clearWifiSamples,
    setWifiMapEnabled,
    setWifiOverlayEnabled,
    wifiMapEnabled,
    wifiOverlayEnabled,
    wifiSurveySummary,
  } from "../lib/stores/wifi.js";
  import { wifiSignalColor } from "../lib/wifi/signal.js";
  import { notify } from "../lib/stores/toast.js";
  import {
    clearRobotTrailHistory,
    robotTrailDisplayPoints,
    robotTrailEnabled,
    robotTrailHistoryEnabled,
    robotTrailHistoryPoints,
    robotTrailHistoryStorage,
    robotTrailSelectedDate,
    selectRobotTrailDate,
    setRobotTrailEnabled,
    setRobotTrailHistoryEnabled,
    todayDateKey,
    robotTrailDataDays,
    jumpToRobotTrailDataDay,
  } from "../lib/stores/robotTrail.js";
  import { adjacentDataDay } from "../lib/robot/trailDays.js";
  import TrailCalendar from "./TrailCalendar.svelte";
  import CaptureToggleHeader from "./CaptureToggleHeader.svelte";
  import MowerControl from "./MowerControl.svelte";
  import { isNarrowScreen } from "../lib/stores/ui.js";
  import OverlayToggleRow from "./OverlayToggleRow.svelte";

  // Shared on/off colors so the Live robot, WiFi, and Movement trail icons
  // read as one consistent language: green once toggled on, muted when off.
  const ICON_ON_COLOR = "var(--ok)";
  const ICON_OFF_COLOR = "var(--muted)";

  // Collapsed by default: the full panel (all three sections) can otherwise
  // eat most of a phone's vertical space, squeezing the mower-control/tool
  // dock stack below it into an unusably cramped layout. Remembered
  // per-device, same pattern as the sidebar panels' Collapsible.
  const HUD_EXPANDED_KEY = "openmower-map-editor-hud-expanded";
  // Phones start collapsed (unless the user expanded it before).
  const savedHud = typeof localStorage === "undefined" ? null : localStorage.getItem(HUD_EXPANDED_KEY);
  let hudExpanded = $state(savedHud == null ? !isNarrowScreen() : savedHud !== "0");

  function toggleHudExpanded() {
    hudExpanded = !hudExpanded;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(HUD_EXPANDED_KEY, hudExpanded ? "1" : "0");
    }
  }

  let ok = $derived($robotLive && $robotPose?.ok);
  let signalColor = $derived(wifiSignalColor($wifiSurveySummary.signalDbm));
  let today = $derived(todayDateKey());
  let isViewingToday = $derived($robotTrailSelectedDate === today);
  // Server truth, not the client-only Live-robot breadcrumb — this must stay
  // accurate even when Live robot is off, since capture itself doesn't
  // depend on it.
  let trailCapturing = $derived(Boolean($robotTrailHistoryStorage.collector?.capturing));

  function toggleWifiMap() {
    setWifiMapEnabled(!$wifiMapEnabled);
  }

  function toggleWifiOverlay() {
    setWifiOverlayEnabled(!$wifiOverlayEnabled);
  }

  function toggleRobotTrail() {
    setRobotTrailEnabled(!$robotTrailEnabled);
  }

  function toggleRobotTrailHistory() {
    setRobotTrailHistoryEnabled(!$robotTrailHistoryEnabled);
  }

  // Trail day picker: a calendar with a dot on days that have data; the
  // arrows skip straight to the previous / next such day.
  let calendarOpen = $state(false);
  let prevDataDay = $derived(adjacentDataDay($robotTrailDataDays, $robotTrailSelectedDate, -1));
  let nextDataDay = $derived(adjacentDataDay($robotTrailDataDays, $robotTrailSelectedDate, 1));
  let selectedLabel = $derived(
    $robotTrailSelectedDate === today
      ? "Today"
      : new Date(`${$robotTrailSelectedDate}T12:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
  );

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "not flushed yet";
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  async function confirmAndClear(confirmMessage, action, successMessage, failureMessage) {
    if (!window.confirm(confirmMessage)) return;
    try {
      await action();
      notify(successMessage, "success");
    } catch (_error) {
      notify(failureMessage, "warn");
    }
  }

  function clearSurvey() {
    return confirmAndClear(
      "Clear the shared WiFi signal map for all devices?",
      clearWifiSamples,
      "Shared WiFi survey cleared.",
      "Could not clear the shared WiFi survey."
    );
  }

  function clearSavedTrail() {
    return confirmAndClear(
      "Clear the mower's saved movement trail for all devices?",
      clearRobotTrailHistory,
      "Saved movement trail cleared.",
      "Could not clear the saved movement trail."
    );
  }
</script>

<div class="glass w-[260px] rounded-2xl px-3 py-2.5">
  <button
    class="flex w-full items-center justify-between gap-2"
    aria-expanded={hudExpanded}
    title={hudExpanded ? "Collapse status panel" : "Expand status panel"}
    onclick={toggleHudExpanded}
  >
    <div class="flex items-center gap-1.5 text-xs font-semibold">
      <span
        class="material-symbols-outlined"
        style="font-size:16px;color:{ok ? ICON_ON_COLOR : $robotLive ? 'var(--warn)' : ICON_OFF_COLOR}"
      >radar</span>
      <span
        class="material-symbols-outlined"
        style="font-size:16px;color:{$wifiMapEnabled ? ICON_ON_COLOR : ICON_OFF_COLOR}"
      >signal_cellular_alt</span>
      <span
        class="material-symbols-outlined"
        style="font-size:16px;color:{$robotTrailEnabled ? ICON_ON_COLOR : ICON_OFF_COLOR}"
      >route</span>
      Status
    </div>
    <span class="material-symbols-outlined text-subtle" style="font-size:20px">
      {hudExpanded ? "expand_less" : "expand_more"}
    </span>
  </button>

  <!-- Robot motion commands: always reachable (even collapsed), and kept
       apart from the map-editing tool dock. -->
  <div class="mt-2">
    <MowerControl />
  </div>

  {#if hudExpanded}
  <div transition:slide={{ duration: 160 }}>
  <div class="mt-2 flex items-center justify-between gap-2">
    <div class="flex items-center gap-2 text-xs font-semibold">
      <span
        class="material-symbols-outlined"
        style="font-size:17px;color:{ok ? ICON_ON_COLOR : $robotLive ? 'var(--warn)' : ICON_OFF_COLOR}"
      >radar</span>
      Live robot
    </div>
    <button
      class="btn-icon !h-7 !w-7"
      class:text-accent={$robotLive}
      title="Toggle live robot overlay"
      onclick={toggleRobotLive}
    >
      <span class="material-symbols-outlined" style="font-size:22px">
        {$robotLive ? "toggle_on" : "toggle_off"}
      </span>
    </button>
  </div>

  {#if $robotLive}
    <div transition:fade={{ duration: 140 }}>
      {#if $robotReadout}
        <pre class="mt-2 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-muted">{$robotReadout}</pre>
      {:else}
        <p class="mt-2 text-[11px] text-subtle">Waiting for pose…</p>
      {/if}
    </div>
  {/if}

  <div class="mt-2 border-t pt-2" style="border-color:var(--glass-edge)">
    <CaptureToggleHeader
      icon="signal_cellular_alt"
      label="WiFi signal map"
      enabled={$wifiMapEnabled}
      toggleTitle="Start/stop capturing the WiFi signal to a file"
      onToggle={toggleWifiMap}
    />

    {#if $wifiMapEnabled}
      <div transition:fade={{ duration: 140 }}>
        <div class="mt-2 flex items-end justify-between gap-2">
          <div>
            <div class="text-lg font-semibold" style="color:{signalColor}">
              {$wifiSurveySummary.signalDbm == null
                ? "-- dBm"
                : `${Math.round($wifiSurveySummary.signalDbm)} dBm`}
            </div>
            <div class="text-[10px] text-subtle">
              {$wifiSurveySummary.signalDbm == null
                ? "Waiting for WiFi data…"
                : $wifiSurveySummary.label}
            </div>
          </div>
          <div class="text-right text-[10px] text-subtle">
            {$wifiSurveySummary.sampleCount} map points
          </div>
        </div>

        <OverlayToggleRow
          label="Overlay heatmap"
          enabled={$wifiOverlayEnabled}
          toggleTitle="Overlay the WiFi signal heatmap on the map"
          onToggle={toggleWifiOverlay}
          clearTitle="Clear the shared WiFi signal map"
          clearDisabled={$wifiSurveySummary.sampleCount === 0}
          onClear={clearSurvey}
        />

        {#if $wifiOverlayEnabled}
          <div transition:fade={{ duration: 140 }} class="mt-1">
            <div
              class="mt-2 h-2 rounded-full"
              style="background:linear-gradient(90deg,#ef4444 0%,#f97316 28%,#facc15 55%,#84cc16 76%,#22c55e 100%)"
              title="red: very weak · green: excellent"
            ></div>
            <div class="mt-1 flex justify-between text-[9px] text-subtle">
              <span>≤ -80 dBm</span>
              <span>≥ -55 dBm</span>
            </div>
            <div class="mt-1 text-[9px] leading-relaxed text-subtle">
              {$wifiSurveySummary.storage.collector?.capturing ? "Capturing now" : "Not capturing"} ·
              {Math.round(($wifiSurveySummary.storage.collector?.intervalMs || 10000) / 1000)} s sample ·
              {$wifiSurveySummary.storage.cellSizeM} m grid ·
              {Math.round($wifiSurveySummary.storage.flushIntervalMs / 1000)} s disk flush ·
              {formatBytes($wifiSurveySummary.storage.fileBytes)}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="mt-2 border-t pt-2" style="border-color:var(--glass-edge)">
    <CaptureToggleHeader
      icon="route"
      label="Movement trail"
      enabled={$robotTrailEnabled}
      toggleTitle="Start/stop recording the mower's movement trail"
      onToggle={toggleRobotTrail}
    />

    {#if $robotTrailEnabled}
      <div transition:fade={{ duration: 140 }}>
        <div class="text-[10px] text-subtle">
          {$robotTrailHistoryPoints.length} point{$robotTrailHistoryPoints.length === 1 ? "" : "s"} today ·
          {trailCapturing ? "capturing now" : "not capturing"}
        </div>

        <OverlayToggleRow
          label="Overlay saved history"
          enabled={$robotTrailHistoryEnabled}
          toggleTitle="Overlay the mower's saved movement trail"
          onToggle={toggleRobotTrailHistory}
          clearTitle="Clear the saved movement trail"
          clearDisabled={!isViewingToday || $robotTrailHistoryPoints.length === 0}
          onClear={clearSavedTrail}
        />

        {#if $robotTrailHistoryEnabled}
          <div transition:fade={{ duration: 140 }} class="mt-1">
            <div class="flex items-center gap-1">
              <button
                class="btn-icon !h-6 !w-6"
                title="Previous day with a recorded trail"
                disabled={!prevDataDay}
                onclick={() => jumpToRobotTrailDataDay(-1)}
              >
                <span class="material-symbols-outlined" style="font-size:16px">chevron_left</span>
              </button>
              <button
                class="date-btn flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md py-0.5 text-[11px]"
                class:open={calendarOpen}
                title="Pick a day — days with a recorded trail have a dot"
                aria-expanded={calendarOpen}
                onclick={() => (calendarOpen = !calendarOpen)}
              >
                <span class="material-symbols-outlined" style="font-size:14px">calendar_month</span>
                <span class="truncate">{selectedLabel}</span>
                {#if $robotTrailDataDays.has($robotTrailSelectedDate)}
                  <span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:var(--ok)"></span>
                {/if}
              </button>
              <button
                class="btn-icon !h-6 !w-6"
                title="Next day with a recorded trail"
                disabled={!nextDataDay}
                onclick={() => jumpToRobotTrailDataDay(1)}
              >
                <span class="material-symbols-outlined" style="font-size:16px">chevron_right</span>
              </button>
              <button
                class="btn-icon !h-6 !w-6"
                title="Jump to today"
                disabled={isViewingToday}
                onclick={() => selectRobotTrailDate(today)}
              >
                <span class="material-symbols-outlined" style="font-size:16px">home</span>
              </button>
            </div>
            <TrailCalendar bind:open={calendarOpen} />

            <div class="mt-2 text-[9px] text-subtle">
              {#if $robotTrailDisplayPoints.length > 0}
                {$robotTrailDisplayPoints.length} points
              {:else}
                No mow recorded this day
              {/if}
            </div>
            <div class="mt-1 text-[9px] leading-relaxed text-subtle">
              {$robotTrailHistoryStorage.minDistanceM} m spacing ·
              {Math.round($robotTrailHistoryStorage.flushIntervalMs / 1000)} s disk flush ·
              {formatBytes($robotTrailHistoryStorage.fileBytes)}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  </div>
  {/if}
</div>

<style>
  .date-btn {
    color: var(--ink);
    border: 1px solid var(--glass-edge);
  }
  .date-btn:hover,
  .date-btn.open {
    border-color: var(--accent);
  }
</style>
