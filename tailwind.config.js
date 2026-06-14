/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{svelte,js}"],
  theme: {
    extend: {
      colors: {
        // UI tokens — resolve to CSS variables defined in src/app.css.
        // Swap with the [data-theme] attribute on <html>.
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        edge: "var(--edge)",
        "edge-soft": "var(--edge-soft)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        subtle: "var(--subtle)",
        accent: "var(--accent)",
        "accent-2": "var(--accent-2)",
        danger: "var(--danger)",
        warn: "var(--warn)",
        ok: "var(--ok)",
      },
      borderColor: {
        DEFAULT: "var(--edge)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Segoe UI",
          "Roboto",
          "system-ui",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glass: "0 12px 40px -12px rgba(2, 6, 23, 0.65)",
        "glow-accent": "0 0 0 1px var(--accent-2), 0 0 18px -2px var(--accent-2)",
      },
      backdropBlur: {
        glass: "18px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
        "scale-in": "scale-in 0.16s ease-out",
      },
    },
  },
  plugins: [],
};
