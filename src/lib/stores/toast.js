import { writable } from "svelte/store";

// `status` is the latest single-line message (replaces the old status bar).
// `toasts` is the transient notification queue rendered bottom-center.
export const status = writable("Load a map to begin.");
export const toasts = writable([]);

let nextId = 1;

/**
 * Show a toast and update the status line.
 * @param {string} text
 * @param {'info'|'success'|'warn'|'error'} kind
 * @param {number} ttl  ms before auto-dismiss (0 = sticky)
 */
export function notify(text, kind = "info", ttl = 3200) {
  status.set(text);
  const id = nextId++;
  toasts.update((list) => [...list, { id, text, kind }]);
  if (ttl > 0) {
    setTimeout(() => dismiss(id), ttl);
  }
  return id;
}

export function dismiss(id) {
  toasts.update((list) => list.filter((t) => t.id !== id));
}

/** Update the status line without raising a toast. */
export function setStatus(text) {
  status.set(text);
}
