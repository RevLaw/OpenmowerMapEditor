import { derived, writable, get } from "svelte/store";
import { editor } from "./editor.js";

// The editor `rev` increments on every change (load, edit, undo/redo). We mark
// the rev that's currently persisted; anything past it means unsaved edits.
const savedRev = writable(0);

export const isDirty = derived(
  [editor, savedRev],
  ([$e, $r]) => $e.mapData != null && $e.rev !== $r
);

/** Mark the current state as saved (call after a successful load or save). */
export function markClean() {
  savedRev.set(get(editor).rev);
}
