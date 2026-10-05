<script>
  import Collapsible from "../Collapsible.svelte";
  import { trailZone, trailZonePath, trailZoneOutline, setTrailZone } from "../../lib/stores/trailZone.js";
  import { robotTrail, robotTrailDisplayPoints, robotTrailHistoryEnabled, robotTrailSelectedDate, setRobotTrailHistoryEnabled } from "../../lib/stores/robotTrail.js";
  import { createZoneFromTrail } from "../../lib/actions.js";
  import { pathLength } from "../../lib/robot/recorder.js";
  import { formatLength, formatArea } from "../../lib/measurements.js";
  import { polygonArea } from "../../lib/geo/geometry.js";

  let sourcePoints = $derived($trailZone.source === "live" ? $robotTrail : $robotTrailDisplayPoints);
  let pct = (v) => `${Math.round(v * 100)}%`;

  function open() {
    // The saved history only loads while its overlay is on.
    if ($trailZone.source === "history" && !$robotTrailHistoryEnabled) setRobotTrailHistoryEnabled(true);
    setTrailZone({ open: true });
  }

  function setSource(source) {
    if (source === "history" && !$robotTrailHistoryEnabled) setRobotTrailHistoryEnabled(true);
    setTrailZone({ source, start: 0, end: 1 });
  }

  function setStart(v) {
    setTrailZone({ start: Math.min(Number(v), $trailZone.end) });
  }
  function setEnd(v) {
    setTrailZone({ end: Math.max(Number(v), $trailZone.start) });
  }
</script>

<Collapsible title="Trail → zone" icon="conversion_path" key="trailzone" open={false}>
  <p class="mb-2 text-[11px] text-subtle">
    Turn a stretch of where the mower drove into a zone — e.g. a boundary you drove earlier with the trail recording.
  </p>

  {#if !$trailZone.open}
    <button class="btn w-full" onclick={open}>
      <span class="material-symbols-outlined" style="font-size:18px">conversion_path</span>
      Pick a trail stretch…
    </button>
  {:else}
    <div class="mb-2 flex rounded-lg p-0.5 text-[11px]" style="background:var(--surface-2)">
      {#each [["history", `Saved · ${$robotTrailSelectedDate}`], ["live", "This session"]] as [id, label]}
        <button
          class="flex-1 rounded-md px-2 py-1 font-medium"
          style={$trailZone.source === id ? "background:var(--surface-3);color:var(--ink)" : "color:var(--subtle)"}
          onclick={() => setSource(id)}
        >
          {label}
        </button>
      {/each}
    </div>

    {#if sourcePoints.length < 3}
      <p class="mb-2 text-[11px]" style="color:var(--warn)">
        {$trailZone.source === "live"
          ? "No live trail yet — turn on Live robot and drive."
          : "No saved trail for this day — pick another date in the status panel."}
      </p>
    {:else}
      <div class="mb-1 flex justify-between text-xs text-muted">
        <span>From</span><span class="font-mono text-accent">{pct($trailZone.start)}</span>
      </div>
      <input class="slider mb-2" type="range" min="0" max="1" step="0.001" value={$trailZone.start} oninput={(e) => setStart(e.currentTarget.value)} />
      <div class="mb-1 flex justify-between text-xs text-muted">
        <span>To</span><span class="font-mono text-accent">{pct($trailZone.end)}</span>
      </div>
      <input class="slider mb-2" type="range" min="0" max="1" step="0.001" value={$trailZone.end} oninput={(e) => setEnd(e.currentTarget.value)} />
      <div class="mb-1 flex justify-between text-xs text-muted">
        <span>Smoothing (m)</span><span class="font-mono text-accent">{$trailZone.tolerance.toFixed(2)}</span>
      </div>
      <input class="slider mb-2" type="range" min="0" max="0.5" step="0.01" value={$trailZone.tolerance} oninput={(e) => setTrailZone({ tolerance: Number(e.currentTarget.value) })} />

      <p class="mb-2 text-[10px] text-subtle">
        {$trailZonePath.length} points · {formatLength(pathLength($trailZonePath))}
        {#if $trailZoneOutline}
          → {$trailZoneOutline.length} vertices · {formatArea(polygonArea($trailZoneOutline))}
        {:else}
          → not a closed area yet
        {/if}
      </p>

      <label class="field">
        Zone type
        <select class="select" value={$trailZone.type} onchange={(e) => setTrailZone({ type: e.currentTarget.value })}>
          <option value="mow">mow</option>
          <option value="obstacle">obstacle</option>
          <option value="nav">nav</option>
        </select>
      </label>
    {/if}

    <div class="grid grid-cols-2 gap-2">
      <button class="btn" onclick={() => setTrailZone({ open: false })}>Cancel</button>
      <button class="btn btn-accent" disabled={!$trailZoneOutline} onclick={createZoneFromTrail}>
        <span class="material-symbols-outlined" style="font-size:18px">check</span>
        Create zone
      </button>
    </div>
  {/if}
</Collapsible>
