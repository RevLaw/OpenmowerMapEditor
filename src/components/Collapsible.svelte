<script>
  import { slide } from "svelte/transition";

  export let title = "";
  export let icon = "";
  export let key = ""; // persistence key; open/closed remembered in localStorage
  export let open = true;

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
    on:click={toggle}
  >
    <span class="flex items-center gap-2">
      {#if icon}<span class="material-symbols-outlined" style="font-size:16px">{icon}</span>{/if}
      {title}
    </span>
    <span class="flex items-center gap-1.5">
      <slot name="badge" />
      <span
        class="material-symbols-outlined text-subtle"
        style="font-size:18px;transition:transform .15s;{open ? '' : 'transform:rotate(-90deg)'}"
        >expand_more</span
      >
    </span>
  </button>

  {#if open}
    <div class="mt-2" transition:slide|local={{ duration: 160 }}>
      <slot />
    </div>
  {/if}
</section>
