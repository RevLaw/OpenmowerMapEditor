<script>
  import Collapsible from "../Collapsible.svelte";
  import { robotLive, robotPose, toggleRobotLive } from "../../lib/stores/robot.js";
  import { rtkText } from "../../lib/robot/telemetry.js";

  // The technical details that used to sit in the robot marker's hover: where
  // the position comes from, raw pose, ROS container, WiFi at the mower.
  let pose = $derived($robotPose?.ok ? $robotPose : null);
  let container = $derived.by(() => {
    const c = pose?.container;
    if (!c) return "";
    if (typeof c === "string") return c;
    if (c.exists === false) return "not found";
    if (c.exists == null) return `unavailable (${c.status || "?"})`;
    const restarts = Number.isFinite(c.restartCount) && c.restartCount > 0 ? ` · ${c.restartCount} restarts` : "";
    return `${c.running ? "running" : "stopped"}${restarts}`;
  });
  let rows = $derived.by(() => {
    if (!pose) return [];
    const out = [
      ["Position source", pose.source === "stream" ? "live stream" : pose.source || "probe"],
      ["Position", `x ${pose.x.toFixed(2)} m · y ${pose.y.toFixed(2)} m`],
      ["Heading", `${Math.round((pose.yaw * 180) / Math.PI)}°`],
    ];
    if (pose.gpsRtk) out.push(["GPS", pose.gpsRtk]);
    const rtk = rtkText(pose.positionAccuracy);
    if (rtk) out.push(["Accuracy", rtk]);
    if (container) out.push(["ROS container", container]);
    if (pose.ros?.topic) out.push(["ROS sample", pose.ros.topic]);
    if (Number.isFinite(pose.wifi?.signalDbm)) {
      out.push(["WiFi at the mower", `${Math.round(pose.wifi.signalDbm)} dBm`]);
    }
    return out;
  });
</script>

<Collapsible title="Diagnostics" icon="monitor_heart" key="diagnostics" open={false}>
  <div class="mb-2 flex items-center justify-between gap-2 text-xs">
    <span>Live robot</span>
    <button class="btn-icon !h-7 !w-7" class:text-accent={$robotLive} title="Toggle live robot" onclick={toggleRobotLive}>
      <span class="material-symbols-outlined" style="font-size:22px">{$robotLive ? "toggle_on" : "toggle_off"}</span>
    </button>
  </div>
  {#if $robotLive && !rows.length}
    <p class="text-[11px] text-subtle">Waiting for pose…</p>
  {/if}
  {#each rows as [label, value] (label)}
    <div class="flex items-baseline justify-between gap-2 py-0.5 text-xs">
      <span class="shrink-0 text-muted">{label}</span>
      <span class="truncate text-right font-mono">{value}</span>
    </div>
  {/each}
</Collapsible>
