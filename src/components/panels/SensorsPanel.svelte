<script>
  import Collapsible from "../Collapsible.svelte";
  import { robotLive, robotPose, setRobotLive } from "../../lib/stores/robot.js";
  import { robotSensors } from "../../lib/stores/sensors.js";
  import { sensorGroups } from "../../lib/robot/sensors.js";

  // Everything the mower reports about itself, grouped: power, position,
  // motors, safety. Values beyond the robot's own critical limits turn red.
  const LEVEL_COLOR = { ok: "var(--ink)", warn: "var(--warn)", crit: "var(--danger)" };

  let groups = $derived(sensorGroups($robotSensors, $robotPose?.ros?.telemetry || null));
</script>

<Collapsible title="Sensors" icon="sensors" key="sensors">
  {#if !$robotLive}
    <p class="mb-2 text-[11px] text-subtle">The sensors arrive with the live robot position.</p>
    <button class="btn w-full" onclick={() => setRobotLive(true)}>
      <span class="material-symbols-outlined" style="font-size:18px">radar</span>
      Show live robot
    </button>
  {:else if !groups.length}
    <p class="text-[11px] text-subtle">Waiting for the robot…</p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each groups as group (group.id)}
        <div>
          <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">{group.title}</div>
          {#each group.rows as row (row.label)}
            <div class="flex items-baseline justify-between gap-2 py-0.5 text-xs" data-level={row.level}>
              <span class="truncate text-muted">{row.label}</span>
              <span
                class="shrink-0 font-mono"
                class:font-semibold={row.level !== "ok"}
                style="color:{LEVEL_COLOR[row.level]}"
              >
                {row.value}
              </span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</Collapsible>
