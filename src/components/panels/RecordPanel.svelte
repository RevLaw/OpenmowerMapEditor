<script>
  import Collapsible from "../Collapsible.svelte";
  import {
    recording,
    startRecording,
    setRecordingPaused,
    setRecordingType,
    trimRecording,
    stopRecording,
  } from "../../lib/stores/recorder.js";
  import { finishRecording } from "../../lib/actions.js";
  import { robotLive, robotPose } from "../../lib/stores/robot.js";
  import { editor } from "../../lib/stores/editor.js";
  import { pathLength } from "../../lib/robot/recorder.js";
  import { formatLength } from "../../lib/measurements.js";

  let type = $state("mow");
  let tolerance = $state(0.05);
  let live = $derived($robotLive && $robotPose?.ok);
  let length = $derived(pathLength($recording.points));

  function start() {
    startRecording(type);
  }

  function discard() {
    if ($recording.points.length > 20 && !window.confirm("Discard the recorded boundary?")) return;
    stopRecording();
  }
</script>

<Collapsible title="Record boundary by driving" icon="radio_button_checked" key="record">
  <p class="mb-2 text-[11px] text-subtle">
    Drive the mower around the area (e.g. with the app's joystick). Its live position is traced and turned into a
    zone — far more accurate than tracing aerial imagery.
  </p>

  {#if !$recording.active}
    <label class="field">
      Zone type
      <select class="select" bind:value={type}>
        <option value="mow">mow</option>
        <option value="obstacle">obstacle</option>
        <option value="nav">nav</option>
      </select>
    </label>
    <button class="btn btn-accent w-full" disabled={!$editor.mapData} onclick={start}>
      <span class="material-symbols-outlined is-filled" style="font-size:18px">radio_button_checked</span>
      Start recording
    </button>
    {#if !$robotLive}
      <p class="mt-1 text-[10px] text-subtle">Starting turns on Live robot (the position source).</p>
    {/if}
  {:else}
    <div class="mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2" style="background:var(--surface-2)">
      <span class="rec-dot" class:paused={$recording.paused}></span>
      <div class="flex-1 text-xs">
        <div class="font-semibold">
          {$recording.paused ? "Paused" : live ? "Recording…" : "Waiting for robot position…"}
        </div>
        <div class="text-[10px] text-subtle">
          {$recording.points.length} points · {formatLength(length)}
        </div>
      </div>
      <select
        class="select !mt-0 !w-auto !py-0.5 text-xs"
        value={$recording.type}
        onchange={(e) => setRecordingType(e.currentTarget.value)}
      >
        <option value="mow">mow</option>
        <option value="obstacle">obstacle</option>
        <option value="nav">nav</option>
      </select>
    </div>

    <div class="mb-1 flex items-center justify-between text-xs text-muted">
      <span>Smoothing (m)</span>
      <span class="font-mono text-accent">{tolerance.toFixed(2)}</span>
    </div>
    <input class="slider mb-2" type="range" min="0" max="0.3" step="0.01" bind:value={tolerance} />

    <div class="mb-2 grid grid-cols-3 gap-1.5">
      <button class="btn !px-1 text-xs" onclick={() => setRecordingPaused(!$recording.paused)}>
        <span class="material-symbols-outlined" style="font-size:17px">{$recording.paused ? "play_arrow" : "pause"}</span>
        {$recording.paused ? "Resume" : "Pause"}
      </button>
      <button class="btn !px-1 text-xs" title="Remove the last ~1 m" disabled={!$recording.points.length} onclick={() => trimRecording(10)}>
        <span class="material-symbols-outlined" style="font-size:17px">undo</span>
        Back
      </button>
      <button class="btn !px-1 text-xs hover:!text-[var(--danger)]" onclick={discard}>
        <span class="material-symbols-outlined" style="font-size:17px">close</span>
        Discard
      </button>
    </div>
    <button class="btn btn-accent w-full" disabled={$recording.points.length < 3} onclick={() => finishRecording(tolerance)}>
      <span class="material-symbols-outlined" style="font-size:18px">check</span>
      Finish &amp; create zone
    </button>
  {/if}
</Collapsible>

<style>
  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
    box-shadow: 0 0 0 0 var(--danger);
    animation: rec-pulse 1.4s infinite;
  }
  .rec-dot.paused {
    background: var(--warn);
    animation: none;
  }
  @keyframes rec-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 60%, transparent);
    }
    70% {
      box-shadow: 0 0 0 8px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }
</style>
