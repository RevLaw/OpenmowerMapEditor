<script>
  import { fly } from "svelte/transition";
  import { activeTool, setTool, polyDraftCount, rulerInfo, drawZoneType } from "../lib/stores/tools.js";
  import { mapApi } from "../lib/stores/mapApi.js";
  import { formatLength } from "../lib/measurements.js";

  const hints = {
    add: { label: "Add point", text: "Click near an edge to insert a vertex" },
    brush: { label: "Push brush", text: "Drag across the outline to push points along your stroke" },
    snap: { label: "Straighten", text: "Click a start point, then an end point" },
    multi: { label: "Multi-select", text: "Click points or Shift+drag a box, then drag the handle" },
    move: { label: "Move zone", text: "Drag the handle to move the whole zone" },
    rect: { label: "Rectangle", text: "Drag on the map to draw a rectangle zone" },
    circle: { label: "Circle", text: "Drag from the center to set the radius" },
    poly: { label: "Polygon", text: "Click to add points · click the first point, double-click or Enter to finish" },
    dock: { label: "Place dock", text: "Click the map to set the docking station" },
    split: { label: "Split zone", text: "Click two points — the zone is cut along that line" },
    ruler: { label: "Measure", text: "Click points to measure · Backspace removes the last" },
  };

  let hint = $derived(hints[$activeTool]);
</script>

{#if hint}
  <div
    transition:fly={{ y: -10, duration: 160 }}
    class="glass flex max-w-[92vw] flex-wrap items-center justify-center gap-2 rounded-full px-4 py-1.5 text-xs shadow-glass"
  >
    <span class="material-symbols-outlined text-accent" style="font-size:16px">info</span>
    <span class="font-semibold">
      {hint.label}{$activeTool === "poly" || $activeTool === "rect" || $activeTool === "circle" ? ` (${$drawZoneType})` : ""}
    </span>
    {#if $activeTool === "poly" && $polyDraftCount > 0}
      <span class="text-muted">{$polyDraftCount} point{$polyDraftCount === 1 ? "" : "s"}</span>
      <button class="chip transition-colors hover:text-ink" onclick={() => $mapApi?.undoPolygonPoint()}>
        Undo point
      </button>
      <button
        class="chip transition-colors hover:text-ink"
        style={$polyDraftCount >= 3 ? "color:var(--ok);border-color:var(--ok)" : ""}
        disabled={$polyDraftCount < 3}
        onclick={() => $mapApi?.finishPolygon()}
      >
        Finish ↵
      </button>
    {:else if $activeTool === "ruler" && $rulerInfo.points > 0}
      <span class="font-mono text-accent">
        {formatLength($rulerInfo.total + $rulerInfo.last)}
      </span>
      <span class="text-subtle">({$rulerInfo.points} pt{$rulerInfo.points === 1 ? "" : "s"})</span>
      <button class="chip transition-colors hover:text-ink" onclick={() => $mapApi?.clearRuler()}>Clear</button>
    {:else}
      <span class="hidden text-muted sm:inline">— {hint.text}</span>
    {/if}
    <button class="chip transition-colors hover:text-ink" onclick={() => setTool("none")}>
      Esc
    </button>
  </div>
{/if}
