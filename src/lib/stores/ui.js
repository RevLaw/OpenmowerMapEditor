import { writable } from "svelte/store";

// Top-level overlay visibility, so deeply-nested buttons can open modals that
// must render outside transformed/overflow-clipped containers (e.g. the sidebar).
export const backupsOpen = writable(false);
