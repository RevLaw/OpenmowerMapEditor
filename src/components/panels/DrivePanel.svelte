<script>
  import Collapsible from "../Collapsible.svelte";
  import { driveMode, robotStateName, robotInRecordingMode, exitDriveMode } from "../../lib/stores/teleop.js";
  import { openDriveScreen } from "../../lib/stores/driveScreen.js";
  import { robotLive, robotPose } from "../../lib/stores/robot.js";

  let live = $derived($robotLive && $robotPose?.ok);
  let on = $derived($driveMode === "on");
  let busy = $derived($driveMode === "entering" || $driveMode === "exiting");
</script>

<Collapsible title="Drive the mower" icon="sports_esports" key="drive">
  <p class="mb-2 text-[11px] text-subtle">
    Opens a fullscreen drive screen: an on-screen joystick, <b>Go to</b> (tap the map and the robot drives there,
    around obstacle zones) and <b>Record</b> to turn the driven path into a zone. This puts OpenMower into its
    area-recording mode — the blade stays off, and nothing is saved on the robot itself.
  </p>

  {#if !on}
    <p class="mb-2 flex items-start gap-1.5 text-[11px]" style="color:var(--warn)">
      <span class="material-symbols-outlined" style="font-size:15px">warning</span>
      This moves the real robot. Keep it in sight; STOP is an emergency stop.
    </p>
    <button class="btn btn-accent w-full" disabled={busy} onclick={() => openDriveScreen()}>
      <span class="material-symbols-outlined" style="font-size:18px">sports_esports</span>
      {$driveMode === "entering" ? "Switching to drive mode…" : "Start drive mode"}
    </button>
    {#if $robotInRecordingMode}
      <p class="mt-1 text-[10px] text-subtle">The robot is already in area-recording mode.</p>
    {/if}
  {:else}
    <div class="mb-2 flex items-center gap-1.5 text-[11px]">
      <span class="h-2 w-2 rounded-full" style="background:{$robotInRecordingMode ? 'var(--ok)' : 'var(--warn)'}"></span>
      {#if !live}
        Waiting for live position…
      {:else if $robotInRecordingMode}
        Ready — robot in recording mode
      {:else}
        Robot state: {$robotStateName || "unknown"} (not accepting joystick yet)
      {/if}
    </div>
    <button class="btn btn-accent w-full" onclick={() => openDriveScreen()}>
      <span class="material-symbols-outlined" style="font-size:18px">open_in_full</span>
      Open drive screen
    </button>
    <button class="btn mt-1.5 w-full" disabled={busy} onclick={exitDriveMode}>
      <span class="material-symbols-outlined" style="font-size:18px">logout</span>
      {$driveMode === "exiting" ? "Leaving drive mode…" : "Leave drive mode"}
    </button>
  {/if}
</Collapsible>
