<script>
  import { slide } from "svelte/transition";
  import Collapsible from "../Collapsible.svelte";
  import { coverageOn } from "../../lib/stores/tools.js";
  import { currentArea, editor } from "../../lib/stores/editor.js";
  import { getAreaType, getZoneOverrides } from "../../lib/format/mapFormat.js";
  import { getEditablePoints } from "../../lib/format/outline.js";
  import { firstSegmentAngle } from "../../lib/geo/geometry.js";
  import { resolveMowSettings } from "../../lib/coverage/mowSettings.js";
  import { mowParams } from "../../lib/stores/mowParams.js";
  import { setZoneOverride } from "../../lib/actions.js";
  import {
    exactPath,
    exactPathLoading,
    computeExactPath,
    clearExactPath,
  } from "../../lib/stores/exactPath.js";

  // The exact path is stale once the zone or its geometry changed after planning.
  $: exactStale =
    $exactPath && ($exactPath.rev !== $editor.rev || $exactPath.areaIndex !== $editor.areaIndex);

  const fmt = (v) => Number(v).toFixed(2).replace(/\.?0+$/, "");
  const SRC = { live: "from robot", file: "from params file", default: "defaults" };

  $: area = $currentArea;
  $: isMow = getAreaType(area) === "mow";
  $: ov = getZoneOverrides(area);
  $: gp = $mowParams;
  $: pts = area ? getEditablePoints(area.outline || []) : [];
  $: autoAngleRad = firstSegmentAngle(pts);
  $: autoAngleDeg = Math.round((autoAngleRad * 180) / Math.PI);
  $: settings = resolveMowSettings(ov, gp, pts);
  $: laps = settings.laps;
  $: overlap = settings.overlap;
  $: offset = settings.outerOffset;
  $: effAngleDeg = Math.round(((settings.angleRad * 180) / Math.PI) % 360);
  $: angleOffsetActive = gp.mowAngleOffsetIsAbsolute || Math.abs(gp.mowAngleOffset || 0) > 0.01;

  // Toggle an override: enable it seeded with the current global value, or clear.
  function toggleOv(rosKey, camelKey, defaultVal) {
    setZoneOverride(rosKey, ov[camelKey] == null ? defaultVal : null);
  }
  function setNum(rosKey, raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) setZoneOverride(rosKey, n);
  }
  function setAngleDeg(raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) setZoneOverride("angle", (n * Math.PI) / 180);
  }
</script>

<Collapsible title="Mowing" icon="grid_on" key="mowing">
  {#if !isMow}
    <p class="text-[11px] text-subtle">
      Select a <b>mow</b> zone to set its parameters and preview the path the robot drives.
    </p>
  {:else}
    <p class="mb-2 text-[10px] text-subtle">
      Per-zone values saved to <code class="text-muted">map.json</code>. Unchecked = the robot's global
      default (<span class="text-muted">{SRC[gp.source] || gp.source}</span>).
    </p>

    <div class="mb-1.5 flex items-center gap-2">
      <input
        type="checkbox"
        class="accent-[var(--accent)]"
        checked={ov.outlineCount != null}
        on:change={() => toggleOv("outline_count", "outlineCount", gp.outlineCount)}
      />
      <span class="flex-1 text-xs text-muted">Outline laps</span>
      <input
        class="input !mt-0 !w-20 !py-1 text-right"
        type="number"
        min="0"
        step="1"
        disabled={ov.outlineCount == null}
        value={ov.outlineCount ?? gp.outlineCount}
        on:change={(e) => setNum("outline_count", e.currentTarget.value)}
      />
    </div>

    <div class="mb-1.5 flex items-center gap-2">
      <input
        type="checkbox"
        class="accent-[var(--accent)]"
        checked={ov.outlineOverlapCount != null}
        on:change={() => toggleOv("outline_overlap_count", "outlineOverlapCount", gp.outlineOverlapCount)}
      />
      <span class="flex-1 text-xs text-muted">Fill overlap</span>
      <input
        class="input !mt-0 !w-20 !py-1 text-right"
        type="number"
        min="0"
        step="1"
        disabled={ov.outlineOverlapCount == null}
        value={ov.outlineOverlapCount ?? gp.outlineOverlapCount}
        on:change={(e) => setNum("outline_overlap_count", e.currentTarget.value)}
      />
    </div>

    <div class="mb-1.5 flex items-center gap-2">
      <input
        type="checkbox"
        class="accent-[var(--accent)]"
        checked={ov.outlineOffset != null}
        on:change={() => toggleOv("outline_offset", "outlineOffset", gp.outlineOffset)}
      />
      <span class="flex-1 text-xs text-muted">Outline offset (m)</span>
      <input
        class="input !mt-0 !w-20 !py-1 text-right"
        type="number"
        step="0.05"
        disabled={ov.outlineOffset == null}
        value={ov.outlineOffset ?? gp.outlineOffset}
        on:change={(e) => setNum("outline_offset", e.currentTarget.value)}
      />
    </div>

    <div class="flex items-center gap-2">
      <input
        type="checkbox"
        class="accent-[var(--accent)]"
        checked={ov.angle != null}
        on:change={() => toggleOv("angle", "angle", autoAngleRad)}
      />
      <span class="flex-1 text-xs text-muted">
        Mow angle (°) <span class="text-subtle">{ov.angle == null ? "· auto" : "· fixed"}</span>
      </span>
      <input
        class="input !mt-0 !w-20 !py-1 text-right"
        type="number"
        step="5"
        disabled={ov.angle == null}
        value={ov.angle != null ? Math.round((ov.angle * 180) / Math.PI) : autoAngleDeg}
        on:change={(e) => setAngleDeg(e.currentTarget.value)}
      />
    </div>

    {#if angleOffsetActive}
      <p class="mt-1 text-[10px] text-subtle">
        {#if gp.mowAngleOffsetIsAbsolute}
          Robot is in <b>absolute</b> angle mode — it mows at {effAngleDeg}° and
          <b>ignores</b> this per-zone angle.
        {:else}
          Robot mows at <b>{effAngleDeg}°</b> (this + global offset {Math.round(gp.mowAngleOffset)}°).
        {/if}
      </p>
    {/if}

    <div
      class="mt-3 flex items-center justify-between border-t pt-2"
      style="border-color:var(--edge-soft)"
    >
      <span class="text-xs font-medium text-muted">Show coverage preview</span>
      <button
        class="btn-icon !h-7 !w-7"
        class:text-accent={$coverageOn}
        title="Toggle coverage overlay"
        on:click={() => coverageOn.update((v) => !v)}
      >
        <span class="material-symbols-outlined" style="font-size:22px">
          {$coverageOn ? "toggle_on" : "toggle_off"}
        </span>
      </button>
    </div>

    {#if $coverageOn}
      <div transition:slide|local={{ duration: 160 }}>
        <dl class="mt-2 space-y-1 text-xs">
          <div class="flex justify-between">
            <dt class="text-muted">Tool width (spacing)</dt>
            <dd class="font-mono text-accent">{fmt(gp.toolWidth)} m</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Outline laps {ov.outlineCount != null ? "· override" : ""}</dt>
            <dd class="font-mono text-accent">{laps}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Fill overlap {ov.outlineOverlapCount != null ? "· override" : ""}</dt>
            <dd class="font-mono text-accent">{overlap}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Outline offset {ov.outlineOffset != null ? "· override" : ""}</dt>
            <dd class="font-mono text-accent">{fmt(offset)} m</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Mow direction {ov.angle != null ? "· fixed" : "· auto"}</dt>
            <dd class="font-mono text-accent">{effAngleDeg}°</dd>
          </div>
        </dl>

        <div class="mt-3 flex items-center gap-3 text-[10px] text-subtle">
          <span class="flex items-center gap-1">
            <span class="inline-block h-0.5 w-4 rounded" style="background:var(--ok)"></span>
            outline (first)
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block h-0.5 w-4 rounded" style="background:var(--accent-2)"></span>
            fill rows
          </span>
        </div>
      </div>
    {/if}

    <div class="mt-3 border-t pt-2" style="border-color:var(--edge-soft)">
      <div class="flex items-center gap-2">
        <button class="btn flex-1" on:click={computeExactPath} disabled={$exactPathLoading}>
          <span class="material-symbols-outlined" style="font-size:18px">
            {$exactPathLoading ? "hourglass_top" : "route"}
          </span>
          {$exactPathLoading ? "Planning…" : "Compute exact path"}
        </button>
        {#if $exactPath}
          <button class="btn-icon !h-8 !w-8" title="Clear exact path" on:click={clearExactPath}>
            <span class="material-symbols-outlined" style="font-size:20px">close</span>
          </button>
        {/if}
      </div>
      {#if $exactPath}
        <p class="mt-1 text-[10px]" style={exactStale ? "color:var(--warn)" : "color:var(--subtle)"}>
          {#if exactStale}
            Edited — recompute to refresh the exact path.
          {:else}
            Real planner: {$exactPath.stats?.laps ?? 0} outline · {$exactPath.stats?.fillRows ?? 0} fill ·
            {$exactPath.stats?.points ?? 0} pts
          {/if}
        </p>
      {:else}
        <p class="mt-1 text-[10px] text-subtle">
          Runs OpenMower's real planner for this zone.
        </p>
      {/if}
    </div>
  {/if}
</Collapsible>
