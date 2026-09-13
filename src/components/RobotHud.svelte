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
    shiftRobotTrailDate,
    todayDateKey,
  } from "../lib/stores/robotTrail.js";
  import CaptureToggleHeader from "./CaptureToggleHeader.svelte";
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
  let hudExpanded =
    typeof localStorage === "undefined" || localStorage.getItem(HUD_EXPANDED_KEY) !== "0";

  function toggleHudExpanded() {
    hudExpanded = !hudExpanded;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(HUD_EXPANDED_KEY, hudExpanded ? "1" : "0");
    }
  }

  $: ok = $robotLive && $robotPose?.ok;
  $: signalColor = wifiSignalColor($wifiSurveySummary.signalDbm);
  $: today = todayDateKey();
  $: isViewingToday = $robotTrailSelectedDate === today;
  // Server truth, not the client-only Live-robot breadcrumb — this must stay
  // accurate even when Live robot is off, since capture itself doesn't
  // depend on it.
  $: trailCapturing = Boolean($robotTrailHistoryStorage.collector?.capturing);

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

  function onDateInput(event) {
    if (event.target.value) selectRobotTrailDate(event.target.value);
  }

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
    on:click={toggleHudExpanded}
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
      on:click={toggleRobotLive}
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
                title="Previous day"
                on:click={() => shiftRobotTrailDate(-1)}
              >
                <span class="material-symbols-outlined" style="font-size:16px">chevron_left</span>
              </button>
              <input
                type="date"
                class="min-w-0 flex-1 rounded bg-transparent text-center text-[10px] text-ink"
                style="border-color:var(--glass-edge)"
                max={today}
                value={$robotTrailSelectedDate}
                on:change={onDateInput}
              />
              <button
                class="btn-icon !h-6 !w-6"
                title="Next day"
                disabled={isViewingToday}
                on:click={() => shiftRobotTrailDate(1)}
              >
                <span class="material-symbols-outlined" style="font-size:16px">chevron_right</span>
              </button>
              <button
                class="btn-icon !h-6 !w-6"
                title="Jump to today"
                disabled={isViewingToday}
                on:click={() => selectRobotTrailDate(today)}
              >
                <span class="material-symbols-outlined" style="font-size:16px">home</span>
              </button>
            </div>

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
