<script>
  import { fade } from "svelte/transition";
  import { robotLive, robotReadout, robotPose, toggleRobotLive } from "../lib/stores/robot.js";

  $: ok = $robotLive && $robotPose?.ok;
</script>

<div class="glass w-[238px] rounded-2xl px-3 py-2.5">
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2 text-xs font-semibold">
      <span
        class="inline-block h-2 w-2 rounded-full"
        style="background:{ok ? 'var(--ok)' : $robotLive ? 'var(--warn)' : 'var(--subtle)'}"
      ></span>
      <span class="material-symbols-outlined" style="font-size:17px">radar</span>
      Live robot
    </div>
    <button
      class="btn-icon !h-7 !w-7"
      class:text-accent={$robotLive}
      title="Toggle live robot overlay"
      on:click={toggleRobotLive}
    >
      <span class="material-symbols-outlined" style="font-size:22px">
        {$robotLive ? "toggle_on" : "toggle_off"}
      </span>
    </button>
  </div>

  {#if $robotLive}
    <div transition:fade={{ duration: 140 }}>
      {#if $robotReadout}
        <pre class="mt-2 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-muted">{$robotReadout}</pre>
      {:else}
        <p class="mt-2 text-[11px] text-subtle">Waiting for pose…</p>
      {/if}
    </div>
  {/if}
</div>
