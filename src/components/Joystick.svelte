<script>
  import { clampStick, keysToStick } from "../lib/robot/teleop.js";

  // Virtual thumbstick: drag the knob (mouse / touch / pen) or hold WASD /
  // arrows while it has focus. Reports x right / y up in [-1, 1]; releasing
  // always reports (0, 0) — the deadman.
  let { onChange = () => {}, disabled = false, size = 168 } = $props();

  let pad = $state();
  let knob = $state({ x: 0, y: 0 });
  let active = $state(false);
  let pointerId = null;
  const keys = new Set();

  function report(x, y) {
    knob = { x, y };
    onChange(x, y);
  }

  function fromEvent(e) {
    const r = pad.getBoundingClientRect();
    const radius = r.width / 2;
    const x = (e.clientX - (r.left + radius)) / radius;
    const y = -(e.clientY - (r.top + radius)) / radius;
    const c = clampStick(x, y);
    report(c.x, c.y);
  }

  function down(e) {
    if (disabled || pointerId != null) return;
    pointerId = e.pointerId;
    try {
      pad.setPointerCapture(e.pointerId);
    } catch (_e) {
      /* pointer already gone — the up / cancel handlers still release */
    }
    active = true;
    fromEvent(e);
    e.preventDefault();
  }

  function move(e) {
    if (e.pointerId !== pointerId) return;
    fromEvent(e);
  }

  function up(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    active = false;
    report(0, 0);
  }

  const DRIVE_KEYS = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];

  function keydown(e) {
    const k = e.key.toLowerCase();
    if (disabled || !DRIVE_KEYS.includes(k)) return;
    // Keep the global shortcuts (arrow nudge, tools) out of it while driving.
    e.preventDefault();
    e.stopPropagation();
    keys.add(k);
    const s = keysToStick(keys);
    active = true;
    report(s.x, s.y);
  }

  function keyup(e) {
    const k = e.key.toLowerCase();
    if (!DRIVE_KEYS.includes(k)) return;
    e.stopPropagation();
    keys.delete(k);
    const s = keysToStick(keys);
    active = keys.size > 0;
    report(s.x, s.y);
  }

  function blur() {
    keys.clear();
    if (pointerId == null) {
      active = false;
      report(0, 0);
    }
  }
</script>

<div
  bind:this={pad}
  class="pad relative shrink-0 touch-none select-none rounded-full"
  class:active
  class:disabled
  style="width:{size}px;height:{size}px"
  role="slider"
  aria-label="Drive joystick — drag, or hold W A S D / arrow keys"
  aria-valuenow={Math.round(knob.y * 100)}
  tabindex={disabled ? -1 : 0}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onlostpointercapture={up}
  onkeydown={keydown}
  onkeyup={keyup}
  onblur={blur}
>
  <span class="ring"></span>
  <span class="cross h"></span>
  <span class="cross v"></span>
  <span class="material-symbols-outlined hint up">keyboard_arrow_up</span>
  <span class="material-symbols-outlined hint down">keyboard_arrow_down</span>
  <span class="material-symbols-outlined hint left">rotate_left</span>
  <span class="material-symbols-outlined hint right">rotate_right</span>
  <span
    class="knob"
    style="transform:translate(calc(-50% + {knob.x * size * 0.36}px), calc(-50% + {-knob.y * size * 0.36}px))"
  ></span>
</div>

<style>
  .pad {
    background: radial-gradient(circle, var(--surface-3) 0%, var(--surface-2) 70%);
    border: 1px solid var(--edge);
    cursor: grab;
    outline: none;
  }
  .pad:focus-visible {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .pad.active {
    cursor: grabbing;
    border-color: var(--accent);
  }
  .pad.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ring {
    position: absolute;
    inset: 18%;
    border-radius: 50%;
    border: 1px dashed var(--edge);
  }
  .cross {
    position: absolute;
    background: var(--edge-soft);
  }
  .cross.h {
    left: 12%;
    right: 12%;
    top: 50%;
    height: 1px;
  }
  .cross.v {
    top: 12%;
    bottom: 12%;
    left: 50%;
    width: 1px;
  }
  .hint {
    position: absolute;
    font-size: 18px;
    color: var(--subtle);
  }
  .hint.up {
    top: 4%;
    left: 50%;
    transform: translateX(-50%);
  }
  .hint.down {
    bottom: 4%;
    left: 50%;
    transform: translateX(-50%);
  }
  .hint.left {
    left: 5%;
    top: 50%;
    transform: translateY(-50%);
  }
  .hint.right {
    right: 5%;
    top: 50%;
    transform: translateY(-50%);
  }
  .knob {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 38%;
    height: 38%;
    border-radius: 50%;
    background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #000));
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transition: transform 0.08s ease-out;
  }
  .pad.active .knob {
    transition: none;
  }
</style>
