import { writable, get } from "svelte/store";
import { editor } from "./editor.js";
import { isDirty } from "./dirty.js";
import { serializeMap } from "../format/mapFormat.js";

// Crash/reload safety net: while there are unsaved edits, the working map is
// mirrored to localStorage (debounced). On the next start, if a draft exists
// that differs from the map the server returned, the user is offered to
// restore it. Cleared whenever the map is saved or a fresh map is loaded clean.
const DRAFT_KEY = "om-draft";
const DEBOUNCE_MS = 1000;

/** A draft found at startup that the user can restore or discard: {savedAt, text} | null. */
export const pendingDraft = writable(null);

let timer = null;
let armed = false; // only start mirroring after startup decided about an old draft

function readDraft() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DRAFT_KEY) : null;
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d.text === "string" && Number.isFinite(d.savedAt) ? d : null;
  } catch (_e) {
    return null;
  }
}

function writeDraft() {
  timer = null;
  const s = get(editor);
  // While an old draft awaits a decision, don't overwrite it with new edits.
  if (!armed || get(pendingDraft) || !s.mapData || !get(isDirty)) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), text: serializeMap(s.mapData) }));
  } catch (_e) {
    /* quota exceeded / storage blocked — the draft is best-effort */
  }
}

export function clearDraft() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(DRAFT_KEY);
  } catch (_e) {
    /* ignore */
  }
}

/**
 * Called once after the startup map load: surfaces an old draft when it
 * differs from what was loaded, then starts mirroring edits.
 * @param {string|null} loadedText  serialized map the editor started with
 */
export function checkForDraft(loadedText) {
  const d = readDraft();
  if (d && d.text !== loadedText) pendingDraft.set(d);
  else if (d) clearDraft();
  armed = true;
}

/** Forget the startup draft (the user chose to keep the loaded map). */
export function discardPendingDraft() {
  pendingDraft.set(null);
  clearDraft();
}

editor.subscribe(() => {
  if (!armed) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(writeDraft, DEBOUNCE_MS);
});

isDirty.subscribe((dirty) => {
  // Saved (or reloaded clean) — the draft no longer holds anything new. Keep
  // a pending startup draft until the user decides about it.
  if (armed && !dirty && !get(pendingDraft)) clearDraft();
});
