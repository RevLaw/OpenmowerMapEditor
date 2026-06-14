<script>
  import { theme, toggleTheme } from "../lib/stores/theme.js";
</script>

<button class="btn-icon" on:click={toggleTheme} title="Toggle light / dark" aria-label="Toggle theme">
  <span class="material-symbols-outlined" style="font-size:20px">
    {$theme === "light" ? "dark_mode" : "light_mode"}
  </span>
</button>
