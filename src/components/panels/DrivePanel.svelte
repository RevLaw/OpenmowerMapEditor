<script>
  import Collapsible from "../Collapsible.svelte";
  import Joystick from "../Joystick.svelte";
  import {
    driveMode,
    driveSpeed,
    driveCommand,
    robotStateName,
    robotInRecordingMode,
    setStick,
    enterDriveMode,
    exitDriveMode,
  } from "../../lib/stores/teleop.js";
  import { robotLive, robotPose } from "../../lib/stores/robot.js";
  import { MAX_LINEAR } from "../../lib/robot/teleop.js";

  let live = $derived($robotLive && $robotPose?.ok);
  let on = $derived($driveMode === "on");
  let busy = $derived($driveMode === "entering" || $driveMode === "exiting");
</script>

<Collapsible title="Drive the mower" icon="sports_esports" key="drive">
  <p class="mb-2 text-[11px] text-subtle">
    Steer the robot from here, e.g. around an area while <b>Record boundary</b> traces it. This puts OpenMower into
    its area-recording mode — the blade stays off, and nothing is saved on the robot itself.
  </p>

  {#if !on}
    <p class="mb-2 flex items-start gap-1.5 text-[11px]" style="color:var(--warn)">
      <span class="material-symbols-outlined" style="font-size:15px">warning</span>
      This moves the real robot. Keep it in sight; Stop (top right) is an emergency stop.
    </p>
    <button class="btn btn-accent w-full" disabled={busy} onclick={enterDriveMode}>
      <span class="material-symbols-outlined" style="font-size:18px">sports_esports</span>
      {$driveMode === "entering" ? "Switching to drive mode…" : "Start drive mode"}
    </button>
    {#if $robotInRecordingMode}
      <p class="mt-1 text-[10px] text-subtle">The robot is already in area-recording mode.</p>
    {/if}
  {:else}
    <div class="mb-2 flex items-center justify-between text-[11px]">
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" style="background:{$robotInRecordingMode ? 'var(--ok)' : 'var(--warn)'}"></span>
        {#if !live}
          Waiting for live position…
        {:else if $robotInRecordingMode}
          Ready — robot in recording mode
        {:else}
          Robot state: {$robotStateName || "unknown"} (not accepting joystick yet)
        {/if}
      </span>
      <span class="font-mono text-subtle">{$driveCommand.lx.toFixed(2)} m/s</span>
    </div>

    <div class="mb-3 flex justify-center">
      <Joystick onChange={setStick} disabled={busy} />
    </div>
    <p class="mb-2 text-center text-[10px] text-subtle">
      Drag the stick, or click it and hold W A S D / arrows. Let go to stop.
    </p>

    <div class="mb-1 flex items-center justify-between text-xs text-muted">
      <span>Max speed</span>
      <span class="font-mono text-accent">{($driveSpeed * MAX_LINEAR).toFixed(2)} m/s</span>
    </div>
    <input class="slider mb-3" type="range" min="0.1" max="1" step="0.05" bind:value={$driveSpeed} />

    <button class="btn w-full" disabled={busy} onclick={exitDriveMode}>
      <span class="material-symbols-outlined" style="font-size:18px">logout</span>
      {$driveMode === "exiting" ? "Leaving drive mode…" : "Leave drive mode"}
    </button>
  {/if}
</Collapsible>
