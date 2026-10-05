<script>
  import { slide } from "svelte/transition";
  import { coverageOn } from "../lib/stores/tools.js";
  import { currentArea, editor } from "../lib/stores/editor.js";
  import { getZoneOverrides } from "../lib/format/mapFormat.js";
  import { getEditablePoints } from "../lib/format/outline.js";
  import { firstSegmentAngle } from "../lib/geo/geometry.js";
  import { resolveMowSettings } from "../lib/coverage/mowSettings.js";
  import { mowParams } from "../lib/stores/mowParams.js";
  import { setZoneOverride } from "../lib/actions.js";
  import { exactPath, exactPathLoading, computeExactPath, clearExactPath } from "../lib/stores/exactPath.js";

  // Per-zone mowing parameters of the selected (mow) zone, shown inside the
  // zone list's inline editor. Unchecked = the robot's global default.
  let { disabled = false } = $props();

  // The exact path is stale once the zone or its geometry changed after planning.
  let exactStale = $derived(
    $exactPath && ($exactPath.rev !== $editor.rev || $exactPath.areaIndex !== $editor.areaIndex)
  );

  const fmt = (v) => Number(v).toFixed(2).replace(/\.?0+$/, "");
  const SRC = { live: "from robot", file: "from params file", default: "defaults" };

  // Read $currentArea directly rather than through a `$derived` alias: the editor
  // store mutates zones in place, and a derived of the same object reference
  // would never invalidate its dependents.
  let ov = $derived(getZoneOverrides($currentArea));
  let gp = $derived($mowParams);
  let pts = $derived($currentArea ? getEditablePoints($currentArea.outline || []) : []);
  let autoAngleRad = $derived(firstSegmentAngle(pts));
  let autoAngleDeg = $derived(Math.round((autoAngleRad * 180) / Math.PI));
  let settings = $derived(resolveMowSettings(ov, gp, pts));
  let effAngleDeg = $derived(Math.round(((settings.angleRad * 180) / Math.PI) % 360));
  let angleOffsetActive = $derived(gp.mowAngleOffsetIsAbsolute || Math.abs(gp.mowAngleOffset || 0) > 0.01);

  let rows = $derived([
    { key: "outline_count", camel: "outlineCount", label: "Outline laps", step: 1, min: 0, value: ov.outlineCount, global: gp.outlineCount },
    { key: "outline_overlap_count", camel: "outlineOverlapCount", label: "Fill overlap", step: 1, min: 0, value: ov.outlineOverlapCount, global: gp.outlineOverlapCount },
    { key: "outline_offset", camel: "outlineOffset", label: "Outline offset (m)", step: 0.05, value: ov.outlineOffset, global: gp.outlineOffset },
  ]);

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

<div class="space-y-1">
  {#each rows as r (r.key)}
    <label class="ov-row" class:custom={r.value != null}>
      <input
        type="checkbox"
        class="accent-[var(--accent)]"
        checked={r.value != null}
        {disabled}
        onchange={() => toggleOv(r.key, r.camel, r.global)}
      />
      <span class="flex-1 truncate">{r.label}</span>
      <input
        class="input !mt-0 !w-16 !py-0.5 text-right font-mono"
        type="number"
        min={r.min}
        step={r.step}
        disabled={disabled || r.value == null}
        value={r.value ?? r.global}
        onchange={(e) => setNum(r.key, e.currentTarget.value)}
      />
    </label>
  {/each}
  <label class="ov-row" class:custom={ov.angle != null}>
    <input
      type="checkbox"
      class="accent-[var(--accent)]"
      checked={ov.angle != null}
      {disabled}
      onchange={() => toggleOv("angle", "angle", autoAngleRad)}
    />
    <span class="flex-1 truncate">
      Mow angle (°) <span class="text-subtle">{ov.angle == null ? "auto" : "fixed"}</span>
    </span>
    <input
      class="input !mt-0 !w-16 !py-0.5 text-right font-mono"
      type="number"
      step="5"
      disabled={disabled || ov.angle == null}
      value={ov.angle != null ? Math.round((ov.angle * 180) / Math.PI) : autoAngleDeg}
      onchange={(e) => setAngleDeg(e.currentTarget.value)}
    />
  </label>
</div>

<p class="mt-1 text-[10px] leading-snug text-subtle">
  Unchecked = robot default (<span class="text-muted">{SRC[gp.source] || gp.source}</span>).
  {#if angleOffsetActive}
    {#if gp.mowAngleOffsetIsAbsolute}
      Robot is in <b>absolute</b> angle mode — it mows at {effAngleDeg}° and ignores the per-zone angle.
    {:else}
      Robot mows at <b>{effAngleDeg}°</b> (this + global offset {Math.round(gp.mowAngleOffset)}°).
    {/if}
  {/if}
</p>

<div class="mt-2 grid grid-cols-2 gap-1.5">
  <button
    class="btn"
    class:btn-accent={$coverageOn}
    title="Overlay the rows the robot drives"
    onclick={() => coverageOn.update((v) => !v)}
  >
    <span class="material-symbols-outlined" style="font-size:16px">grid_on</span>
    Preview
  </button>
  <button class="btn" onclick={computeExactPath} disabled={$exactPathLoading} title="Run OpenMower's real planner for this zone">
    <span class="material-symbols-outlined" style="font-size:16px">{$exactPathLoading ? "hourglass_top" : "route"}</span>
    {$exactPathLoading ? "Planning…" : "Exact path"}
  </button>
</div>

{#if $coverageOn}
  <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-subtle" transition:slide={{ duration: 140 }}>
    <span>width <b class="font-mono text-accent">{fmt(gp.toolWidth)} m</b></span>
    <span>laps <b class="font-mono text-accent">{settings.laps}</b></span>
    <span>overlap <b class="font-mono text-accent">{settings.overlap}</b></span>
    <span>angle <b class="font-mono text-accent">{effAngleDeg}°</b></span>
    <span class="flex items-center gap-1">
      <span class="inline-block h-0.5 w-3 rounded" style="background:var(--ok)"></span>outline
    </span>
    <span class="flex items-center gap-1">
      <span class="inline-block h-0.5 w-3 rounded" style="background:var(--accent-2)"></span>fill
    </span>
  </div>
{/if}

{#if $exactPath}
  <div class="mt-1 flex items-center gap-1 text-[10px]" style={exactStale ? "color:var(--warn)" : "color:var(--subtle)"}>
    <span class="flex-1">
      {#if exactStale}
        Edited — recompute to refresh the exact path.
      {:else}
        Real planner: {$exactPath.stats?.laps ?? 0} outline · {$exactPath.stats?.fillRows ?? 0} fill ·
        {$exactPath.stats?.points ?? 0} pts
      {/if}
    </span>
    <button class="btn-icon !h-6 !w-6" title="Clear exact path" onclick={clearExactPath}>
      <span class="material-symbols-outlined" style="font-size:15px">close</span>
    </button>
  </div>
{/if}

<style>
  .ov-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
    cursor: pointer;
  }
  .ov-row.custom {
    color: var(--ink);
  }
</style>
