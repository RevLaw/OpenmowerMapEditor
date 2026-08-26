<script>
  import { fade } from "svelte/transition";
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
    robotTrail,
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

  // Shared on/off colors so the Live robot, WiFi, and Movement trail icons
  // read as one consistent language: green once toggled on, muted when off.
  const ICON_ON_COLOR = "var(--ok)";
  const ICON_OFF_COLOR = "var(--muted)";

  $: ok = $robotLive && $robotPose?.ok;
  $: signalColor = wifiSignalColor($wifiSurveySummary.signalDbm);
  $: today = todayDateKey();
  $: isViewingToday = $robotTrailSelectedDate === today;
  $: trailSpanLabel = (() => {
    if ($robotTrail.length < 2) return null;
    const seconds = Math.round(($robotTrail[$robotTrail.length - 1].t - $robotTrail[0].t) / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
  })();

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
  <div class="flex items-center justify-between gap-2">
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
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 text-xs font-semibold">
        <span
          class="material-symbols-outlined"
          style="font-size:17px;color:{$wifiMapEnabled ? ICON_ON_COLOR : ICON_OFF_COLOR}"
        >signal_cellular_alt</span>
        WiFi signal map
      </div>
      <button
        class="btn-icon !h-7 !w-7"
        class:text-accent={$wifiMapEnabled}
        title="Start/stop capturing the WiFi signal to a file"
        on:click={toggleWifiMap}
      >
        <span class="material-symbols-outlined" style="font-size:22px">
          {$wifiMapEnabled ? "toggle_on" : "toggle_off"}
        </span>
      </button>
    </div>

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

        <div class="mt-2 flex items-center justify-between gap-2 border-t pt-2" style="border-color:var(--glass-edge)">
          <span class="text-[10px] text-subtle">Overlay heatmap</span>
          <div class="flex items-center gap-1">
            <button
              class="btn-icon !h-6 !w-6"
              title="Clear the shared WiFi signal map"
              disabled={$wifiSurveySummary.sampleCount === 0}
              on:click={clearSurvey}
            >
              <span class="material-symbols-outlined" style="font-size:16px">delete</span>
            </button>
            <button
              class="btn-icon !h-6 !w-6"
              class:text-accent={$wifiOverlayEnabled}
              title="Overlay the WiFi signal heatmap on the map"
              on:click={toggleWifiOverlay}
            >
              <span class="material-symbols-outlined" style="font-size:18px">
                {$wifiOverlayEnabled ? "toggle_on" : "toggle_off"}
              </span>
            </button>
          </div>
        </div>

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
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 text-xs font-semibold">
        <span
          class="material-symbols-outlined"
          style="font-size:17px;color:{$robotTrailEnabled ? ICON_ON_COLOR : ICON_OFF_COLOR}"
        >route</span>
        Movement trail
      </div>
      <button
        class="btn-icon !h-7 !w-7"
        class:text-accent={$robotTrailEnabled}
        title="Start/stop recording the mower's movement trail"
        on:click={toggleRobotTrail}
      >
        <span class="material-symbols-outlined" style="font-size:22px">
          {$robotTrailEnabled ? "toggle_on" : "toggle_off"}
        </span>
      </button>
    </div>

    {#if $robotTrailEnabled}
      <div transition:fade={{ duration: 140 }}>
        <div class="text-[10px] text-subtle">
          {$robotTrail.length} point{$robotTrail.length === 1 ? "" : "s"}{trailSpanLabel ? ` · last ${trailSpanLabel}` : ""}
        </div>

        <div class="mt-2 flex items-center justify-between gap-2 border-t pt-2" style="border-color:var(--glass-edge)">
          <span class="text-[10px] text-subtle">Overlay saved history</span>
          <div class="flex items-center gap-1">
            <button
              class="btn-icon !h-6 !w-6"
              title="Clear the saved movement trail"
              disabled={!isViewingToday || $robotTrailHistoryPoints.length === 0}
              on:click={clearSavedTrail}
            >
              <span class="material-symbols-outlined" style="font-size:16px">delete</span>
            </button>
            <button
              class="btn-icon !h-6 !w-6"
              class:text-accent={$robotTrailHistoryEnabled}
              title="Overlay the mower's saved movement trail"
              on:click={toggleRobotTrailHistory}
            >
              <span class="material-symbols-outlined" style="font-size:18px">
                {$robotTrailHistoryEnabled ? "toggle_on" : "toggle_off"}
              </span>
            </button>
          </div>
        </div>

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
              {$robotTrailHistoryStorage.collector?.capturing ? "Capturing now" : "Not capturing"} ·
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
