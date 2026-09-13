import { derived, get, writable } from "svelte/store";
import { deleteWifiMap, fetchWifiMap, recordWifiSamples, setWifiCapture } from "../api.js";
import { mergeWifiSample, wifiPercentFromDbm, wifiSignalLabel } from "../wifi/signal.js";
import { createCaptureSync } from "./captureSync.js";

// "Enabled" here means capture is on — a shared, mower-side setting (every
// browser, persists across restarts), not a per-browser display preference.
// The localStorage value is just an optimistic first guess before the first
// sync corrects it to server truth.
const ENABLED_KEY = "openmower-map-editor-wifi-map-enabled";
const OVERLAY_ENABLED_KEY = "openmower-map-editor-wifi-overlay-enabled";
const LEGACY_SAMPLES_KEY = "openmower-map-editor-wifi-map-v1";
const SYNC_MS = 15000;
const MIN_RECORD_MS = 2000;
const STATIONARY_RECORD_MS = 5000;

function loadEnabled() {
  return typeof localStorage !== "undefined" && localStorage.getItem(ENABLED_KEY) === "1";
}

function loadOverlayEnabled() {
  return typeof localStorage !== "undefined" && localStorage.getItem(OVERLAY_ENABLED_KEY) === "1";
}

/** Is WiFi capture currently on? Shared/server state. */
export const wifiMapEnabled = writable(loadEnabled());
/** Overlay the heatmap on the map — a local display toggle only. */
export const wifiOverlayEnabled = writable(loadOverlayEnabled());
export const wifiSamples = writable([]);
export const latestWifiSignal = writable(null);
export const wifiSurveyStorage = writable({
  central: true,
  cellSizeM: 0.75,
  maxPoints: 2000,
  flushIntervalMs: 30000,
  fileBytes: 0,
  collector: {
    enabled: true,
    capturing: false,
    intervalMs: 10000,
    cellRevisitMs: 300000,
  },
});
/**
 * Just the grid size, as its own store. wifiSurveyStorage gets a fresh object
 * every sync (even on unchanged/notModified polls), so subscribing to it
 * directly would re-render the heatmap every 15s for nothing; this derived
 * store only notifies when the number itself actually changes.
 */
export const wifiCellSizeM = derived(wifiSurveyStorage, ($storage) => $storage?.cellSizeM || 0.75);

wifiMapEnabled.subscribe((enabled) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  }
  // The overlay toggle is only shown nested under this one; turning this off
  // would otherwise strand the overlay on with no visible control to turn it
  // back off.
  if (!enabled) wifiOverlayEnabled.set(false);
});

wifiOverlayEnabled.subscribe((enabled) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(OVERLAY_ENABLED_KEY, enabled ? "1" : "0");
  }
});

export const wifiSurveySummary = derived(
  [wifiSamples, latestWifiSignal, wifiSurveyStorage],
  ([$samples, $latest, $storage]) => ({
    sampleCount: $samples.length,
    signalDbm: $latest?.signalDbm ?? null,
    percent: wifiPercentFromDbm($latest?.signalDbm),
    label: wifiSignalLabel($latest?.signalDbm),
    interface: $latest?.interface || null,
    storage: $storage,
  })
);

function applyWifiPayload(data, isCurrentEpoch) {
  const collector = data?.storage?.collector;
  if (data?.storage) {
    wifiSurveyStorage.set(data.storage);
    if (isCurrentEpoch) {
      wifiMapEnabled.set(Boolean(collector?.capturing));
    }
  }
  if (Number.isFinite(collector?.lastSignalDbm)) {
    latestWifiSignal.set({
      signalDbm: collector.lastSignalDbm,
      interface: collector.lastInterface || null,
    });
  }
  if (!data?.notModified && Array.isArray(data?.samples)) {
    wifiSamples.set(data.samples);
  }
}

const wifiCapture = createCaptureSync({
  fetchData: fetchWifiMap,
  setCapture: setWifiCapture,
  applyPayload: applyWifiPayload,
  enabledStore: wifiMapEnabled,
  featureLabel: "WiFi signal map",
});

export const syncWifiSamples = wifiCapture.sync;

/** Starts/stops the mower's WiFi capture. Shared and persisted — affects every browser. */
export const setWifiMapEnabled = wifiCapture.setEnabled;

async function migrateLegacySamples() {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(LEGACY_SAMPLES_KEY);
  if (!raw) return;
  try {
    const samples = JSON.parse(raw);
    if (Array.isArray(samples) && samples.length) {
      await recordWifiSamples(samples.slice(-2000));
    }
    localStorage.removeItem(LEGACY_SAMPLES_KEY);
  } catch (_error) {
    // Keep the old data so migration can retry on the next page load.
  }
}

export function setWifiOverlayEnabled(enabled) {
  wifiOverlayEnabled.set(Boolean(enabled));
}

let recordInFlight = false;
let lastRecordAt = 0;
let lastRecordCell = null;

export function ingestWifiPose(pose) {
  const signalDbm = pose?.wifi?.signalDbm;
  if (!Number.isFinite(signalDbm)) return;
  latestWifiSignal.set(pose.wifi);
  if (!get(wifiMapEnabled) || !pose?.ok || recordInFlight) return;
  // The server collector owns recording by default; this remains a fallback
  // for whenever it isn't actively capturing right now.
  if (get(wifiSurveyStorage).collector?.capturing === true) return;

  const now = Date.now();
  const cellSizeM = get(wifiSurveyStorage).cellSizeM || 0.75;
  const cell = `${Math.round(pose.x / cellSizeM)},${Math.round(pose.y / cellSizeM)}`;
  const minimumInterval = cell === lastRecordCell ? STATIONARY_RECORD_MS : MIN_RECORD_MS;
  if (now - lastRecordAt < minimumInterval) return;

  const sample = { x: pose.x, y: pose.y, signalDbm, timestamp: now };
  lastRecordAt = now;
  lastRecordCell = cell;
  wifiSamples.update((samples) => mergeWifiSample(samples, sample, now));

  recordInFlight = true;
  recordWifiSamples([{ x: sample.x, y: sample.y, signalDbm: sample.signalDbm }])
    .catch(() => wifiCapture.syncQuietly(true))
    .finally(() => {
      recordInFlight = false;
    });
}

export async function clearWifiSamples() {
  const requestEpoch = wifiCapture.currentEpoch();
  const data = await deleteWifiMap();
  wifiCapture.apply({ ...data, samples: [] }, requestEpoch);
}

/**
 * Wire periodic sync while the tab is visible. Runs regardless of either
 * toggle — capture status is shared/operational, not just a display
 * preference, so the main toggle needs to stay accurate even when the
 * heatmap overlay is off.
 */
export function initWifiSurveyLifecycle() {
  return wifiCapture.initLifecycle(SYNC_MS, { beforeFirstSync: migrateLegacySamples });
}
