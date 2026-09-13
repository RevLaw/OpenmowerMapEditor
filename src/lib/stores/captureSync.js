import { notify } from "./toast.js";

/**
 * Shared machinery behind every mower-side, persisted on/off capture toggle
 * (WiFi survey, movement trail): status and payload sync from the server via
 * a revision number (skip resending unchanged data), with an optimistic
 * local toggle update that a slow in-flight poll can't stomp on afterwards.
 *
 * `fetchData(revision)` / `setCapture(enabled)` are the API calls.
 * `applyPayload(data, isCurrentEpoch)` is called with every server response
 * (a fresh sync or a capture-toggle result) and owns updating whatever
 * stores the caller holds — `isCurrentEpoch` tells it whether this response
 * is still the latest in-flight request, so it knows whether it's safe to
 * touch the enabled store itself (a superseded response only updates
 * everything else, leaving the toggle's own outcome to land instead).
 */
export function createCaptureSync({ fetchData, setCapture, applyPayload, enabledStore, featureLabel }) {
  let knownRevision = null;
  let syncPromise = null;
  let captureIntentEpoch = 0;

  function apply(data, requestEpoch = captureIntentEpoch) {
    if (Number.isFinite(data?.revision)) knownRevision = data.revision;
    applyPayload(data, requestEpoch === captureIntentEpoch);
  }

  async function sync(force = false) {
    if (syncPromise) return syncPromise;
    const requestEpoch = captureIntentEpoch;
    syncPromise = (async () => {
      try {
        const data = await fetchData(force ? null : knownRevision);
        apply(data, requestEpoch);
        return data;
      } finally {
        syncPromise = null;
      }
    })();
    return syncPromise;
  }

  function syncQuietly(force = false) {
    sync(force).catch(() => {});
  }

  async function setEnabled(enabled) {
    const want = Boolean(enabled);
    captureIntentEpoch += 1;
    const requestEpoch = captureIntentEpoch;
    enabledStore.set(want); // optimistic; corrected by the server's response either way
    try {
      const data = await setCapture(want);
      apply(data, requestEpoch);
      // Superseded by a later toggle already in flight — let that one's own
      // outcome speak instead of announcing a direction that's no longer current.
      if (requestEpoch === captureIntentEpoch) {
        notify(`${featureLabel}: capture ${want ? "started" : "stopped"}.`, want ? "success" : "info");
      }
    } catch (_error) {
      if (requestEpoch === captureIntentEpoch) enabledStore.set(!want);
      notify(`${featureLabel}: could not ${want ? "start" : "stop"} capture.`, "warn");
    }
  }

  /** Snapshot the current epoch before an out-of-band request (e.g. a clear), so its
   * eventual response can still be checked for staleness against a toggle that raced it. */
  function currentEpoch() {
    return captureIntentEpoch;
  }

  /** Wires periodic sync while the tab is visible; runs regardless of any display-only
   * toggle, since capture status is shared/operational and must stay accurate either way. */
  function initLifecycle(syncMs, { beforeFirstSync } = {}) {
    if (typeof document === "undefined") return () => {};
    let timer = null;
    const syncIfVisible = () => {
      if (!document.hidden) syncQuietly();
    };

    if (beforeFirstSync) {
      beforeFirstSync().finally(syncIfVisible);
    } else {
      syncIfVisible();
    }
    timer = setInterval(syncIfVisible, syncMs);
    document.addEventListener("visibilitychange", syncIfVisible);
    return () => {
      if (timer != null) clearInterval(timer);
      document.removeEventListener("visibilitychange", syncIfVisible);
    };
  }

  return { sync, syncQuietly, setEnabled, initLifecycle, apply, currentEpoch };
}
