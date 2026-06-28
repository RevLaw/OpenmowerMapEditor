module.exports = {
  plugins: {
    // Tailwind v4 ships its own PostCSS plugin and handles vendor prefixing
    // (via Lightning CSS), so autoprefixer is no longer needed.
    "@tailwindcss/postcss": {},
  },
};
