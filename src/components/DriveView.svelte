<script>
  import Joystick from "./Joystick.svelte";
  import {
    driveMode,
    driveSpeed,
    driveCommand,
    robotStateName,
    robotInRecordingMode,
    setStick,
    releaseStick,
  } from "../lib/stores/teleop.js";
  import { gotoState, armGoto, cancelGoto, startGoto, stopGoto, gotoBlocker } from "../lib/stores/goto.js";
  import {
    recording,
    startRecording,
    setRecordingPaused,
    trimRecording,
    stopRecording,
  } from "../lib/stores/recorder.js";
  import { finishRecording } from "../lib/actions.js";
  import { sendMowerControl } from "../lib/stores/control.js";
  import { robotPose } from "../lib/stores/robot.js";
  import { editor } from "../lib/stores/editor.js";
  import { isDirty } from "../lib/stores/dirty.js";
  import { driveView, followRobot } from "../lib/stores/ui.js";
  import { closeDriveScreen } from "../lib/stores/driveScreen.js";
  import { MAX_LINEAR } from "../lib/robot/teleop.js";
  import { pathLength } from "../lib/robot/recorder.js";
  import { formatLength } from "../lib/measurements.js";

  // Fullscreen drive screen: the map (following the robot) with the joystick,
  // Go to and boundary recording on top. Go-to's safety rules live in
  // lib/stores/goto.js; this component only shows state and forwards taps.
  const ZONE_TYPES = ["mow", "obstacle", "nav"];
  const ACCURACY_OK_M = 0.2;
  const RECORD_SMOOTHING_M = 0.05;

  let typePicker = $state(false);
  let confirmExit = $state(false);

  let ready = $derived($driveMode === "on" && $robotInRecordingMode);
  let busy = $derived($driveMode === "entering" || $driveMode === "exiting");
  let acc = $derived($robotPose?.ok ? $robotPose.positionAccuracy : null);
  let accOk = $derived(acc != null && acc <= ACCURACY_OK_M);
  let g = $derived($gotoState);
  let gotoActive = $derived(g.phase === "picking" || g.phase === "planned" || g.phase === "driving");
  let recLength = $derived(pathLength($recording.points));
  // gotoBlocker() reads the latest pose; touching the stores re-runs it on every update.
  let blocker = $derived.by(() => {
    void $robotPose;
    void $driveMode;
    void $robotInRecordingMode;
    return gotoBlocker();
  });
  let status = $derived.by(() => {
    if ($driveMode === "entering") return "Switching to drive mode…";
    if ($driveMode === "exiting") return "Leaving drive mode…";
    if (!$robotPose?.ok) return "Waiting for live position…";
    if (!$robotInRecordingMode) return `${$robotStateName || "Unknown state"} — not accepting commands yet`;
    return "Ready";
  });

  function emergencyStop() {
    stopGoto("STOP pressed.");
    releaseStick();
    sendMowerControl("stop");
  }

  function toggleGoto() {
    if (g.phase === "driving") stopGoto("Stop pressed.");
    else if (gotoActive) cancelGoto();
    else armGoto();
  }

  function record(type) {
    typePicker = false;
    startRecording(type);
  }

  function discard() {
    if ($recording.points.length > 20 && !window.confirm("Discard the recorded boundary?")) return;
    stopRecording();
  }

  function exit() {
    if ($recording.active) {
      confirmExit = true;
      return;
    }
    closeDriveScreen();
  }

  function exitFinish() {
    confirmExit = false;
    finishRecording(RECORD_SMOOTHING_M);
    closeDriveScreen();
  }

  function exitDiscard() {
    confirmExit = false;
    stopRecording();
    closeDriveScreen();
  }

  function onKey(e) {
    if (!$driveView || e.key !== "Escape") return;
    if (confirmExit) confirmExit = false;
    else if (g.phase === "driving") stopGoto("Esc pressed.");
    else if (g.phase !== "idle") cancelGoto();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if $driveView}
  <div class="drive pointer-events-none absolute inset-0 z-40 flex flex-col justify-between gap-2">
    <!-- Top: status, follow, STOP, Exit -->
    <div class="flex items-start justify-between gap-2">
      <div class="glass pointer-events-auto flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2 text-xs">
        <span
          class="h-2.5 w-2.5 shrink-0 rounded-full"
          style="background:{ready && accOk ? 'var(--ok)' : 'var(--warn)'}"
        ></span>
        <span class="truncate font-semibold">{status}</span>
        <span class="shrink-0 font-mono text-subtle">{$driveCommand.lx.toFixed(2)} m/s</span>
        <span class="shrink-0 font-mono" class:text-muted={accOk} style={accOk ? "" : "color:var(--warn)"}>
          RTK {acc == null ? "—" : `${Math.round(acc * 100)} cm`}
        </span>
      </div>
      <div class="pointer-events-auto flex shrink-0 gap-2">
        <button
          class="glass dv-btn"
          class:text-accent={$followRobot}
          title={$followRobot ? "Stop following the robot" : "Follow the robot"}
          aria-pressed={$followRobot}
          onclick={() => followRobot.set(!$followRobot)}
        >
          <span class="material-symbols-outlined">{$followRobot ? "my_location" : "location_searching"}</span>
        </button>
        <button class="dv-btn dv-stop" title="Emergency stop" onclick={emergencyStop}>STOP</button>
        <button class="glass dv-btn" disabled={busy} title="Leave drive mode" onclick={exit}>
          <span class="material-symbols-outlined">logout</span>
          Exit
        </button>
      </div>
    </div>

    <!-- Bottom: sheets, then joystick (left) and actions (right) -->
    <div class="flex flex-col gap-2">
      {#if gotoActive || g.phase === "arrived" || g.phase === "stopped"}
        <div class="glass pointer-events-auto mx-auto w-full max-w-md rounded-2xl px-3 py-2 text-xs">
          {#if g.phase === "picking"}
            <div class="flex items-center justify-between gap-2">
              <span>Tap where the robot should go.</span>
              <button class="btn dv-sheet-btn" onclick={cancelGoto}>Cancel</button>
            </div>
            {#if g.reason}<p class="mt-1" style="color:var(--warn)">{g.reason}</p>{/if}
          {:else if g.phase === "planned"}
            <div class="flex items-center gap-2">
              <button class="btn btn-accent dv-sheet-btn flex-1" disabled={!!blocker} onclick={startGoto}>
                <span class="material-symbols-outlined" style="font-size:18px">flag</span>
                Go · {formatLength(g.length)}
              </button>
              <button class="btn dv-sheet-btn" onclick={cancelGoto}>Cancel</button>
            </div>
            {#if blocker || g.reason}<p class="mt-1" style="color:var(--warn)">{blocker || g.reason}</p>{/if}
            {#if $isDirty}<p class="mt-1 text-subtle">Route uses unsaved map edits.</p>{/if}
          {:else if g.phase === "driving"}
            <div class="flex items-center gap-2">
              <span class="flex-1">Driving to the target · {formatLength(g.remaining)} left</span>
              <button class="dv-btn dv-stop" onclick={() => stopGoto("Stop pressed.")}>Stop</button>
            </div>
          {:else if g.phase === "arrived"}
            <span>Arrived.</span>
          {:else}
            <span style="color:var(--warn)">Stopped: {g.reason}</span>
          {/if}
        </div>
      {/if}

      {#if $recording.active}
        <div class="glass pointer-events-auto mx-auto w-full max-w-md rounded-2xl px-3 py-2 text-xs">
          <div class="mb-2 flex items-center gap-2">
            <span class="rec-dot" class:paused={$recording.paused}></span>
            <span class="flex-1 font-semibold">
              {$recording.paused ? "Paused" : "Recording"} {$recording.type} zone ·
              {$recording.points.length} points · {formatLength(recLength)}
            </span>
          </div>
          <div class="grid grid-cols-4 gap-1.5">
            <button class="btn dv-sheet-btn" onclick={() => setRecordingPaused(!$recording.paused)}>
              {$recording.paused ? "Resume" : "Pause"}
            </button>
            <button class="btn dv-sheet-btn" disabled={!$recording.points.length} onclick={() => trimRecording(10)}>
              Back
            </button>
            <button class="btn dv-sheet-btn" onclick={discard}>Discard</button>
            <button
              class="btn btn-accent dv-sheet-btn"
              disabled={$recording.points.length < 3}
              onclick={() => finishRecording(RECORD_SMOOTHING_M)}
            >
              Finish
            </button>
          </div>
        </div>
      {:else if typePicker}
        <div class="glass pointer-events-auto mx-auto flex gap-1.5 rounded-2xl p-2 text-xs">
          <span class="self-center px-1 text-subtle">Record a</span>
          {#each ZONE_TYPES as type (type)}
            <button class="btn dv-sheet-btn" onclick={() => record(type)}>{type}</button>
          {/each}
          <span class="self-center px-1 text-subtle">zone</span>
        </div>
      {/if}

      <div class="flex items-end justify-between gap-3">
        <div class="glass pointer-events-auto flex flex-col items-center gap-2 rounded-3xl p-3">
          <Joystick onChange={setStick} disabled={busy} size={176} />
          <label class="flex w-full items-center gap-2 text-[11px] text-muted">
            Max
            <input
              class="slider flex-1"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              aria-label="Maximum joystick speed"
              bind:value={$driveSpeed}
            />
            <span class="font-mono text-accent">{($driveSpeed * MAX_LINEAR).toFixed(2)}</span>
          </label>
        </div>
        <div class="pointer-events-auto flex flex-col gap-2">
          <button class="glass dv-action" class:on={gotoActive} disabled={$driveMode !== "on"} onclick={toggleGoto}>
            <span class="material-symbols-outlined">flag</span>
            {gotoActive ? "Cancel" : "Go to"}
          </button>
          <button
            class="glass dv-action"
            class:on={$recording.active || typePicker}
            disabled={$recording.active || !$editor.mapData}
            onclick={() => (typePicker = !typePicker)}
          >
            <span class="material-symbols-outlined is-filled" style="color:var(--danger)">radio_button_checked</span>
            Record
          </button>
        </div>
      </div>
    </div>
  </div>

  {#if confirmExit}
    <div class="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="glass w-full max-w-xs rounded-2xl p-4 text-sm" role="dialog" aria-modal="true" aria-label="Recording in progress">
        <p class="mb-3 font-semibold">A recording is still running.</p>
        <div class="flex flex-col gap-2">
          <button class="btn btn-accent dv-sheet-btn" disabled={$recording.points.length < 3} onclick={exitFinish}>
            Finish &amp; create zone
          </button>
          <button class="btn dv-sheet-btn" onclick={exitDiscard}>Discard recording</button>
          <button class="btn dv-sheet-btn" onclick={() => (confirmExit = false)}>Stay</button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .drive {
    padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
      max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  }
  .dv-btn {
    display: inline-flex;
    min-height: 44px;
    min-width: 44px;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 14px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .dv-stop {
    background: var(--danger);
    color: #fff;
    letter-spacing: 0.04em;
  }
  .dv-action {
    display: flex;
    min-height: 48px;
    min-width: 104px;
    align-items: center;
    gap: 6px;
    border-radius: 16px;
    padding: 0 14px;
    font-size: 13px;
    font-weight: 600;
  }
  .dv-action.on {
    color: var(--accent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .dv-sheet-btn {
    min-height: 44px;
  }
  .dv-btn:disabled,
  .dv-action:disabled {
    opacity: 0.45;
  }
  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
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
