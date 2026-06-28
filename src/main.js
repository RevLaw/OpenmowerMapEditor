import "leaflet/dist/leaflet.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

// Svelte 5 mounts the root component with mount() — the legacy
// `new App({ target })` API throws effect_orphan at init.
const app = mount(App, { target: document.getElementById("app") });

export default app;
