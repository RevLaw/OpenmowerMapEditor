import { writable } from "svelte/store";

// Set by MapCanvas once the Leaflet controller is created. Lets non-map
// components call into the map (fit, pan-to, center) without prop drilling.
export const mapApi = writable(null);
