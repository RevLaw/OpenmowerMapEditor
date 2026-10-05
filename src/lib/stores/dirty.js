import { derived, writable, get } from "svelte/store";
import { editor } from "./editor.js";
import { cloneMap } from "../format/mapFormat.js";

// The editor `rev` increments on every change (load, edit, undo/redo). We mark
// the rev that's currently persisted; anything past it means unsaved edits.
const savedRev = writable(0);

/** Copy of the map as last loaded/saved — the baseline the save dialog diffs against. */
export const savedSnapshot = writable(null);

export const isDirty = derived(
  [editor, savedRev],
  ([$e, $r]) => $e.mapData != null && $e.rev !== $r
);

/** Mark the current state as saved (call after a successful load or save). */
export function markClean() {
  const s = get(editor);
  savedSnapshot.set(s.mapData ? cloneMap(s.mapData) : null);
  savedRev.set(s.rev);
}
