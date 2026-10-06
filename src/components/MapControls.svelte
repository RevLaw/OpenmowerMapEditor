<script>
  import { mapApi } from "../lib/stores/mapApi.js";
  import { followRobot } from "../lib/stores/ui.js";
  import { robotLive, robotPose, setRobotLive } from "../lib/stores/robot.js";
  import { robotTrailHistoryEnabled, setRobotTrailHistoryEnabled } from "../lib/stores/robotTrail.js";
  import { notify } from "../lib/stores/toast.js";

  // Map view controls, stacked above the base-map switcher: find / follow the
  // robot, show where it drove, zoom.
  let live = $derived($robotLive && $robotPose?.ok);

  function locate() {
    if ($followRobot) {
      followRobot.set(false);
      return;
    }
    if (!$robotLive) {
      setRobotLive(true);
      notify("Finding the robot…", "info", 1800);
    }
    // Follow centers on the robot now if it has a position, else on the first one.
    followRobot.set(true);
  }
</script>

<div class="glass flex flex-col gap-0.5 rounded-xl p-1">
  <button
    class="btn-icon !h-9 !w-9"
    class:on={$followRobot}
    title={$followRobot ? "Stop following the robot" : "Find & follow the robot"}
    aria-label="Follow robot"
    aria-pressed={$followRobot}
    onclick={locate}
  >
    <span class="material-symbols-outlined" style="font-size:22px">
      {$followRobot ? "my_location" : live ? "location_searching" : "location_disabled"}
    </span>
  </button>
  <button
    class="btn-icon !h-9 !w-9"
    class:on={$robotTrailHistoryEnabled}
    title={$robotTrailHistoryEnabled ? "Hide where the robot drove" : "Show where the robot drove (saved trail)"}
    aria-label="Show trail"
    aria-pressed={$robotTrailHistoryEnabled}
    onclick={() => setRobotTrailHistoryEnabled(!$robotTrailHistoryEnabled)}
  >
    <span class="material-symbols-outlined" style="font-size:22px">route</span>
  </button>
  <div class="mx-1 h-px" style="background:var(--edge-soft)"></div>
  <button class="btn-icon !h-9 !w-9" title="Zoom in" aria-label="Zoom in" onclick={() => $mapApi?.zoomIn()}>
    <span class="material-symbols-outlined" style="font-size:22px">add</span>
  </button>
  <button class="btn-icon !h-9 !w-9" title="Zoom out" aria-label="Zoom out" onclick={() => $mapApi?.zoomOut()}>
    <span class="material-symbols-outlined" style="font-size:22px">remove</span>
  </button>
</div>

<style>
  .btn-icon.on {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
</style>
