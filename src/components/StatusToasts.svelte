<script>
  import { fly, fade } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { toasts, dismiss } from "../lib/stores/toast.js";
  import { driveView } from "../lib/stores/ui.js";

  // Toasts let touches through to the map (a drag starting on one used to do
  // nothing), except on their close button. In the drive screen they still
  // move up above the joystick so its close button can't land on the stick.
  const ABOVE_JOYSTICK = "320px";

  const icon = { info: "info", success: "check_circle", warn: "warning", error: "error" };
  const color = {
    info: "var(--accent)",
    success: "var(--ok)",
    warn: "var(--warn)",
    error: "var(--danger)",
  };
</script>

<div
  class="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
  style:bottom={$driveView ? ABOVE_JOYSTICK : null}
>
  {#each $toasts as t (t.id)}
    <div
      animate:flip={{ duration: 200 }}
      in:fly={{ y: 18, duration: 200 }}
      out:fade={{ duration: 150 }}
      data-toast
      class="glass pointer-events-none flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm"
    >
      <span class="material-symbols-outlined" style="font-size:18px;color:{color[t.kind]}">
        {icon[t.kind]}
      </span>
      <span>{t.text}</span>
      <button class="btn-icon pointer-events-auto !h-6 !w-6" onclick={() => dismiss(t.id)} aria-label="Dismiss">
        <span class="material-symbols-outlined" style="font-size:15px">close</span>
      </button>
    </div>
  {/each}
</div>
