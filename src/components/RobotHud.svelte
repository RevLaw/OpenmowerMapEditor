<script>
  import MowerControl from "./MowerControl.svelte";
  import { robotLive, robotPose, setRobotLive } from "../lib/stores/robot.js";
  import { robotStateLabel, rtkText, robotAlert } from "../lib/robot/telemetry.js";

  // Top-right status: the mower controls plus one line of state. Sensors,
  // trail, WiFi survey and diagnostics live in the sidebar's Robot tab.
  const LEVEL_COLOR = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--danger)" };

  let pose = $derived($robotLive && $robotPose?.ok ? $robotPose : null);
  let telemetry = $derived(pose?.ros?.telemetry || null);
  let alert = $derived(pose ? robotAlert(pose) : null);
  let parts = $derived.by(() => {
    if (!pose) return [];
    const out = [robotStateLabel(telemetry) || "Robot"];
    if (Number.isFinite(telemetry?.batteryPercent)) out.push(`${Math.round(telemetry.batteryPercent)}%`);
    const rtk = rtkText(pose.positionAccuracy);
    if (rtk) out.push(rtk);
    return out;
  });
</script>

<div class="glass w-[260px] rounded-2xl px-3 py-2.5">
  <MowerControl />

  <div class="mt-2 flex min-w-0 items-center gap-2 text-xs">
    {#if !$robotLive}
      <button class="btn w-full !py-1 text-xs" onclick={() => setRobotLive(true)}>
        <span class="material-symbols-outlined" style="font-size:16px">radar</span>
        Show live robot
      </button>
    {:else if !pose}
      <span class="h-2 w-2 shrink-0 rounded-full" style="background:var(--warn)"></span>
      <span class="text-subtle">Waiting for the robot…</span>
    {:else}
      <span
        class="h-2 w-2 shrink-0 rounded-full"
        style="background:{LEVEL_COLOR[alert?.level || 'ok']}"
        title={alert?.text || "All good"}
      ></span>
      <span class="min-w-0 truncate font-semibold" title={parts.join(" · ")}>{parts.join(" · ")}</span>
    {/if}
  </div>
</div>
