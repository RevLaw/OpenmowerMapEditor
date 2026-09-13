<script>
  import { activeTool, setTool, toggleTool } from "../lib/stores/tools.js";
  import { history } from "../lib/stores/editor.js";
  import { undo, redo, removePoint } from "../lib/actions.js";
  import { sendMowerControl, controlSending } from "../lib/stores/control.js";

  const tools = [
    { id: "none", icon: "near_me", label: "Select / drag (V)" },
    { id: "add", icon: "add_location_alt", label: "Add point (A)" },
    { id: "brush", icon: "blur_circular", label: "Push brush (B)" },
    { id: "snap", icon: "horizontal_rule", label: "Snap line (S)" },
    { id: "multi", icon: "select_all", label: "Multi-select (M)" },
    { id: "move", icon: "open_with", label: "Move whole zone (G)" },
  ];

  function pick(id) {
    if (id === "none") setTool("none");
    else toggleTool(id);
  }

  // Mower control (Start/Stop/Home/Reset) used to float as its own separate
  // glass panel next to this one; merged in as one more grid group so the
  // whole right-side control stack reads as a single panel instead of two.
  const MOWER_BUTTONS = [
    { cmd: "start", icon: "play_arrow", label: "Start", color: "var(--ok)", confirm: true },
    { cmd: "stop", icon: "e911_emergency", label: "Stop", color: "var(--danger)", confirm: false, stop: true },
    { cmd: "home", icon: "home", label: "Home", color: "var(--accent)", confirm: true },
    { cmd: "reset_emergency", icon: "restart_alt", label: "Reset E-stop", color: "var(--warn)", confirm: true },
  ];

  // Motion-causing mower commands need a 2-step confirm; Stop is one tap.
  let armed = null;
  let armTimer = null;

  function disarmMower() {
    armed = null;
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  }

  function runMower(cmd) {
    disarmMower();
    sendMowerControl(cmd);
  }

  function clickMower(b) {
    if (!b.confirm || armed === b.cmd) {
      runMower(b.cmd);
      return;
    }
    disarmMower();
    armed = b.cmd;
    armTimer = setTimeout(() => (armed = null), 3000);
  }
</script>

<!-- 2-column grid instead of one tall column — a divider spans both grid
     columns (grid-column:1/-1), which always forces a new row, keeping the
     groups (mower control / tools / delete / undo-redo) visually separated.
     Grid auto-sizes the columns to the buttons' own size, so this doesn't
     need a guessed pixel width the way flex-wrap would. -->
<div class="glass grid grid-cols-2 gap-1 rounded-2xl p-1.5">
  {#each MOWER_BUTTONS as b}
    <div class="hicon" style="--c:{b.color}">
      <button
        class="tool-btn mbtn"
        class:armed={armed === b.cmd}
        class:stop={b.stop}
        disabled={$controlSending}
        aria-label={b.label}
        on:click={() => clickMower(b)}
      >
        <span class="material-symbols-outlined" style="font-size:22px">{b.icon}</span>
      </button>
      <span class="hicon-label" class:show={armed === b.cmd}>
        {armed === b.cmd ? "Confirm?" : b.label}
      </span>
    </div>
  {/each}

  <div class="my-1 h-px" style="grid-column:1/-1;background:var(--edge-soft)"></div>

  {#each tools as t}
    <div class="hicon">
      <button
        class="tool-btn"
        class:active={$activeTool === t.id}
        aria-label={t.label}
        on:click={() => pick(t.id)}
      >
        <span class="material-symbols-outlined" style="font-size:22px">{t.icon}</span>
      </button>
      <span class="hicon-label">{t.label}</span>
    </div>
  {/each}

  <div class="my-1 h-px" style="grid-column:1/-1;background:var(--edge-soft)"></div>

  <div class="hicon" style="grid-column:1/-1">
    <button class="tool-btn danger" aria-label="Remove selected point (Del)" on:click={removePoint}>
      <span class="material-symbols-outlined" style="font-size:22px">delete</span>
    </button>
    <span class="hicon-label">Remove point (Del)</span>
  </div>

  <div class="my-1 h-px" style="grid-column:1/-1;background:var(--edge-soft)"></div>

  <div class="hicon">
    <button class="tool-btn" disabled={!$history.canUndo} aria-label="Undo (Ctrl+Z)" on:click={undo}>
      <span class="material-symbols-outlined" style="font-size:22px">undo</span>
    </button>
    <span class="hicon-label">Undo (Ctrl+Z)</span>
  </div>
  <div class="hicon">
    <button class="tool-btn" disabled={!$history.canRedo} aria-label="Redo (Ctrl+Shift+Z)" on:click={redo}>
      <span class="material-symbols-outlined" style="font-size:22px">redo</span>
    </button>
    <span class="hicon-label">Redo (Ctrl+Shift+Z)</span>
  </div>
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
