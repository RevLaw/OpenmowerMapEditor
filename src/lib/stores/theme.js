import { writable } from "svelte/store";

const STORAGE_KEY = "openmower-map-editor-theme";

function initial() {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  }
  return "dark";
}

export const theme = writable(initial());

theme.subscribe((value) => {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", value);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, value);
  }
});

export function toggleTheme() {
  theme.update((t) => (t === "light" ? "dark" : "light"));
}
