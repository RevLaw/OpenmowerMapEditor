<script>
  import { onDestroy } from "svelte";
  import { clampStick, keysToStick, turboBubble } from "../lib/robot/teleop.js";

  // Virtual thumbstick: drag the knob (mouse / touch / pen) or hold WASD /
  // arrows while it has focus. Reports x right / y up in [-1, 1] plus a turbo
  // flag; releasing always reports (0, 0) — the deadman. With `turbo`, a sprint
  // bubble sits above the ring: slide the thumb up into it (or Shift + W) to
  // sprint, back down to drive normally.
  let { onChange = () => {}, disabled = false, size = 168, turbo: sprint = false } = $props();

  // Bubble geometry in pad radii (its hit area is turboBubble() in lib/robot/teleop.js).
  const BUBBLE_CENTER = 1.45;
  const BUBBLE_DIAMETER = 0.85;
  const BUBBLE_STEER = 0.5;

  let pad = $state();
  let knob = $state({ x: 0, y: 0 });
  let active = $state(false);
  let turboOn = $state(false);
  let pointerId = null;
  let shift = false;
  const keys = new Set();

  let radius = $derived(size / 2);

  // Disappearing while held (screen closed, hot reload) must still let go —
  // otherwise the drive loop keeps sending the last command. $state is already
  // reset when onDestroy runs, so the "held" flag (and, to be safe, the
  // handler) live in plain variables.
  let release = onChange;
  let held = false;
  $effect.pre(() => {
    release = onChange;
  });
  onDestroy(() => {
    if (held) release(0, 0, false);
  });

  function report(x, y, turbo = false) {
    knob = { x, y };
    if (turbo && !turboOn) buzz();
    turboOn = turbo;
    held = turbo || x !== 0 || y !== 0;
    release(x, y, turbo);
  }

  function buzz() {
    try {
      navigator.vibrate?.(30);
    } catch (_e) {
      /* no haptics */
    }
  }

  function fromEvent(e) {
    const r = pad.getBoundingClientRect();
    const radius = r.width / 2;
    const x = (e.clientX - (r.left + radius)) / radius;
    const y = -(e.clientY - (r.top + radius)) / radius;
    if (sprint) {
      const b = turboBubble(x, y);
      if (b.turbo) {
        report(b.x, 1, true);
        return;
      }
    }
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

  // Shift + forward sprints (A / D steer); anything else drives normally.
  function reportKeys() {
    const s = keysToStick(keys);
    report(s.x, s.y, sprint && shift && s.y > 0);
  }

  function keydown(e) {
    const k = e.key.toLowerCase();
    if (k === "shift") {
      shift = true;
      if (keys.size) reportKeys();
      return;
    }
    if (disabled || !DRIVE_KEYS.includes(k)) return;
    // Keep the global shortcuts (arrow nudge, tools) out of it while driving.
    e.preventDefault();
    e.stopPropagation();
    shift = e.shiftKey;
    keys.add(k);
    active = true;
    reportKeys();
  }

  function keyup(e) {
    const k = e.key.toLowerCase();
    if (k === "shift") {
      shift = false;
      if (keys.size) reportKeys();
      return;
    }
    if (!DRIVE_KEYS.includes(k)) return;
    e.stopPropagation();
    keys.delete(k);
    active = keys.size > 0;
    reportKeys();
  }

  function blur() {
    shift = false;
    keys.clear();
    if (pointerId == null) {
      active = false;
      report(0, 0);
    }
  }
</script>

<div class="flex shrink-0 flex-col items-center" style="width:{size}px">
{#if sprint}
  <!-- Sprint bubble: visual only — the thumb slides up into it from the pad
       (pointer capture keeps the drag). Centre at BUBBLE_CENTER radii above
       the pad's centre. -->
  <div
    class="turbo-bubble"
    class:on={turboOn}
    aria-hidden="true"
    style="width:{radius * BUBBLE_DIAMETER}px;height:{radius * BUBBLE_DIAMETER}px;margin-bottom:{radius *
      (BUBBLE_CENTER - 1 - BUBBLE_DIAMETER / 2)}px"
  >
    <span class="material-symbols-outlined">keyboard_double_arrow_up</span>
  </div>
{/if}
<div
  bind:this={pad}
  class="pad relative shrink-0 touch-none select-none rounded-full"
  class:active
  class:disabled
  style="width:{size}px;height:{size}px"
  role="slider"
  aria-label={sprint
    ? "Drive joystick — drag, or hold W A S D / arrow keys; slide up into the bubble or hold Shift to sprint"
    : "Drive joystick — drag, or hold W A S D / arrow keys"}
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
    class:turbo={turboOn}
    style={turboOn
      ? `transform:translate(calc(-50% + ${knob.x * BUBBLE_STEER * radius}px), calc(-50% - ${BUBBLE_CENTER * radius}px))`
      : `transform:translate(calc(-50% + ${knob.x * size * 0.36}px), calc(-50% + ${-knob.y * size * 0.36}px))`}
  ></span>
</div>
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
  .knob.turbo {
    background: linear-gradient(180deg, var(--warn), color-mix(in srgb, var(--warn) 60%, #000));
  }
  .turbo-bubble {
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px dashed var(--edge);
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
    color: var(--subtle);
    transition: all 0.12s ease-out;
  }
  .turbo-bubble.on {
    border: 1px solid var(--warn);
    background: color-mix(in srgb, var(--warn) 25%, transparent);
    color: var(--warn);
    box-shadow: 0 0 18px -4px var(--warn);
  }
  .pad.active .knob {
    transition: none;
  }
</style>
