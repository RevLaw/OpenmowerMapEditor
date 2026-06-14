import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// During `npm run dev`, Vite serves the Svelte app with HMR and proxies the
// `/api/*` calls to the Express backend (run it separately with e.g.
// `PORT=5080 MAP_PATH=./ros/map.json node server.js`).
const apiTarget = process.env.API_PROXY_TARGET || "http://localhost:5080";

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.js"],
  },
});
