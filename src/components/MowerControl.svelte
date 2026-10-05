<script>
  import { sendMowerControl, controlSending } from "../lib/stores/control.js";

  // Robot motion commands live in the status HUD, apart from the map-editing
  // tools, so "edit the map" and "move a real robot with blades" never share
  // a button cluster. Start/Home/Reset need a 2-step confirm; Stop is one tap.
  const BUTTONS = [
    { cmd: "start", icon: "play_arrow", label: "Start", color: "var(--ok)", confirm: true },
    { cmd: "home", icon: "home", label: "Home", color: "var(--accent)", confirm: true },
    { cmd: "reset_emergency", icon: "restart_alt", label: "Reset E-stop", color: "var(--warn)", confirm: true },
    { cmd: "stop", icon: "e911_emergency", label: "Stop", color: "var(--danger)", confirm: false, stop: true },
  ];

  let armed = $state(null);
  let armTimer = null;

  function disarm() {
    armed = null;
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  }

  function click(b) {
    if (!b.confirm || armed === b.cmd) {
      disarm();
      sendMowerControl(b.cmd);
      return;
    }
    disarm();
    armed = b.cmd;
    armTimer = setTimeout(() => (armed = null), 3000);
  }
</script>

<div class="grid grid-cols-4 gap-1">
  {#each BUTTONS as b}
    <button
      class="mbtn flex flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-semibold"
      class:armed={armed === b.cmd}
      class:stop={b.stop}
      style="--c:{b.color}"
      disabled={$controlSending}
      title={b.confirm ? `${b.label} (tap twice to confirm)` : b.label}
      aria-label={b.label}
      onclick={() => click(b)}
    >
      <span class="material-symbols-outlined" style="font-size:20px">{b.icon}</span>
      <span class="truncate">{armed === b.cmd ? "Confirm?" : b.label}</span>
    </button>
  {/each}
</div>

<style>
  .mbtn {
    background: var(--surface-2);
    border: 1px solid var(--edge-soft);
    color: var(--muted);
    transition: all 0.15s;
  }
  .mbtn:hover:not(:disabled) {
    border-color: var(--c);
    color: var(--c);
  }
  .mbtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .mbtn.armed {
    background: var(--c);
    border-color: var(--c);
    color: #04121f;
  }
  .mbtn.stop {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }
  .mbtn.stop:hover:not(:disabled) {
    filter: brightness(1.1);
    color: #fff;
  }
  @media (pointer: coarse) {
    .mbtn {
      min-height: 44px;
    }
  }
</style>
