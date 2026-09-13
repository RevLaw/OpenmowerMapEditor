<script>
  // Header row shared by every mower-side capture toggle (WiFi survey,
  // movement trail): an icon+label that tints on/off, and the on/off button
  // itself. Kept separate from whatever each feature shows once expanded —
  // that content differs too much per feature to share.
  export let icon;
  export let label;
  export let enabled;
  export let toggleTitle;
  export let onToggle;
</script>

<div class="flex items-center justify-between gap-2">
  <div class="flex items-center gap-2 text-xs font-semibold">
    <span
      class="material-symbols-outlined"
      style="font-size:17px;color:{enabled ? 'var(--ok)' : 'var(--muted)'}"
    >{icon}</span>
    {label}
  </div>
  <button
    class="btn-icon !h-7 !w-7"
    class:text-accent={enabled}
    title={toggleTitle}
    on:click={onToggle}
  >
    <span class="material-symbols-outlined" style="font-size:22px">
      {enabled ? "toggle_on" : "toggle_off"}
    </span>
  </button>
</div>
