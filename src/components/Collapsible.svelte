<script>
  import { slide } from "svelte/transition";

  let {
    title = "",
    icon = "",
    key = "", // persistence key; open/closed remembered in localStorage
    open = $bindable(true),
    badge,
    children,
  } = $props();

  // Read once at setup: `key` is a static per-panel constant, and the saved
  // open/closed state only needs restoring on mount.
  // svelte-ignore state_referenced_locally
  const storeKey = key ? `om-panel-${key}` : "";
  if (storeKey && typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(storeKey);
    if (saved === "1") open = true;
    else if (saved === "0") open = false;
  }

  function toggle() {
    open = !open;
    if (storeKey && typeof localStorage !== "undefined") {
      localStorage.setItem(storeKey, open ? "1" : "0");
    }
  }
</script>

<section class="card">
  <button
    type="button"
    class="card-title !mb-0 w-full justify-between"
    aria-expanded={open}
    onclick={toggle}
  >
    <span class="flex items-center gap-2">
      {#if icon}<span class="material-symbols-outlined" style="font-size:16px">{icon}</span>{/if}
      {title}
    </span>
    <span class="flex items-center gap-1.5">
      {@render badge?.()}
      <span
        class="material-symbols-outlined text-subtle"
        style="font-size:18px;transition:transform .15s;{open ? '' : 'transform:rotate(-90deg)'}"
        >expand_more</span
      >
    </span>
  </button>

  {#if open}
    <div class="mt-2" transition:slide={{ duration: 160 }}>
      {@render children?.()}
    </div>
  {/if}
</section>
