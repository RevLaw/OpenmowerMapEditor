<script>
  // Nested "overlay this on the map" row shared by every capture toggle's
  // expanded panel: a label, a trash icon to clear the stored data, and the
  // overlay display toggle itself.
  export let label;
  export let enabled;
  export let toggleTitle;
  export let onToggle;
  export let clearTitle;
  export let clearDisabled = false;
  export let onClear;
</script>

<div class="mt-2 flex items-center justify-between gap-2 border-t pt-2" style="border-color:var(--glass-edge)">
  <span class="text-[10px] text-subtle">{label}</span>
  <div class="flex items-center gap-1">
    <button
      class="btn-icon !h-6 !w-6"
      title={clearTitle}
      disabled={clearDisabled}
      on:click={onClear}
    >
      <span class="material-symbols-outlined" style="font-size:16px">delete</span>
    </button>
    <button
      class="btn-icon !h-6 !w-6"
      class:text-accent={enabled}
      title={toggleTitle}
      on:click={onToggle}
    >
      <span class="material-symbols-outlined" style="font-size:18px">
        {enabled ? "toggle_on" : "toggle_off"}
      </span>
    </button>
  </div>
</div>
