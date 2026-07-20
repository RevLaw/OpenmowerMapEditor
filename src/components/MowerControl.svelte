<script>
  import { sendMowerControl, controlSending } from "../lib/stores/control.js";

  const BUTTONS = [
    { cmd: "start", icon: "play_arrow", label: "Start", color: "var(--ok)", confirm: true },
    { cmd: "stop", icon: "e911_emergency", label: "Stop", color: "var(--danger)", confirm: false, stop: true },
    { cmd: "home", icon: "home", label: "Home", color: "var(--accent)", confirm: true },
    { cmd: "reset_emergency", icon: "restart_alt", label: "Reset E-stop", color: "var(--warn)", confirm: true },
  ];

  // Motion-causing commands need a 2-step confirm; Stop is one tap.
  let armed = null;
  let armTimer = null;

  function disarm() {
    armed = null;
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  }

  function run(cmd) {
    disarm();
    sendMowerControl(cmd);
  }

  function click(b) {
    if (!b.confirm || armed === b.cmd) {
      run(b.cmd);
      return;
    }
    disarm();
    armed = b.cmd;
    armTimer = setTimeout(() => (armed = null), 3000);
  }
</script>

<div class="glass flex flex-col gap-1 rounded-2xl p-1.5">
  {#each BUTTONS as b}
    <div class="hicon" style="--c:{b.color}">
      <button
        class="tool-btn mbtn"
        class:armed={armed === b.cmd}
        class:stop={b.stop}
        disabled={$controlSending}
        aria-label={b.label}
        on:click={() => click(b)}
      >
        <span class="material-symbols-outlined" style="font-size:22px">{b.icon}</span>
      </button>
      <span class="hicon-label" class:show={armed === b.cmd}>
        {armed === b.cmd ? "Confirm?" : b.label}
      </span>
    </div>
  {/each}
</div>

<style>
  /* Command tint on hover (base sizing/shape inherited from .tool-btn). */
  .mbtn:hover:not(:disabled) {
    border-color: var(--c);
    color: var(--c);
  }
  /* Armed (awaiting confirm) fills with the command colour. */
  .mbtn.armed {
    background: var(--c);
    border-color: var(--c);
    color: #04121f;
    transform: none;
  }
  /* Stop stays prominent even icon-only. */
  .mbtn.stop {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }
  .mbtn.stop:hover:not(:disabled) {
    filter: brightness(1.1);
    color: #fff;
    border-color: var(--danger);
  }
</style>
