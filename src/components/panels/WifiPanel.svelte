<script>
  import { fade } from "svelte/transition";
  import Collapsible from "../Collapsible.svelte";
  import CaptureToggleHeader from "../CaptureToggleHeader.svelte";
  import OverlayToggleRow from "../OverlayToggleRow.svelte";
  import {
    clearWifiSamples,
    setWifiMapEnabled,
    setWifiOverlayEnabled,
    wifiMapEnabled,
    wifiOverlayEnabled,
    wifiSurveySummary,
  } from "../../lib/stores/wifi.js";
  import { wifiSignalColor } from "../../lib/wifi/signal.js";
  import { confirmAndNotify } from "../../lib/stores/toast.js";
  import { formatBytes } from "../../lib/measurements.js";

  let signalColor = $derived(wifiSignalColor($wifiSurveySummary.signalDbm));

  function clearSurvey() {
    return confirmAndNotify(
      "Clear the shared WiFi signal map for all devices?",
      clearWifiSamples,
      "Shared WiFi survey cleared.",
      "Could not clear the shared WiFi survey."
    );
  }
</script>

<Collapsible title="WiFi survey" icon="signal_cellular_alt" key="wifi">
  <CaptureToggleHeader
    icon="signal_cellular_alt"
    label="WiFi signal map"
    enabled={$wifiMapEnabled}
    toggleTitle="Start/stop capturing the WiFi signal to a file"
    onToggle={() => setWifiMapEnabled(!$wifiMapEnabled)}
  />

  {#if $wifiMapEnabled}
    <div transition:fade={{ duration: 140 }}>
      <div class="mt-2 flex items-end justify-between gap-2">
        <div>
          <div class="text-lg font-semibold" style="color:{signalColor}">
            {$wifiSurveySummary.signalDbm == null ? "-- dBm" : `${Math.round($wifiSurveySummary.signalDbm)} dBm`}
          </div>
          <div class="text-[10px] text-subtle">
            {$wifiSurveySummary.signalDbm == null ? "Waiting for WiFi data…" : $wifiSurveySummary.label}
          </div>
        </div>
        <div class="text-right text-[10px] text-subtle">{$wifiSurveySummary.sampleCount} map points</div>
      </div>

      <OverlayToggleRow
        label="Overlay heatmap"
        enabled={$wifiOverlayEnabled}
        toggleTitle="Overlay the WiFi signal heatmap on the map"
        onToggle={() => setWifiOverlayEnabled(!$wifiOverlayEnabled)}
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
</Collapsible>
