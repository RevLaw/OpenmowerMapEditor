<script>
  import { fly } from "svelte/transition";
  import { activeTool, setTool } from "../lib/stores/tools.js";

  const hints = {
    add: { label: "Add point", text: "Click near an edge to insert a vertex" },
    brush: { label: "Push brush", text: "Drag across the outline to push points along your stroke" },
    snap: { label: "Snap line", text: "Click a start point, then an end point" },
    multi: { label: "Multi-select", text: "Click points or Shift+drag a box, then drag the handle" },
    move: { label: "Move zone", text: "Drag the handle to move the whole zone" },
    rect: { label: "Rectangle", text: "Drag on the map to draw a rectangle zone" },
    circle: { label: "Circle", text: "Drag from the center to set the radius" },
    dock: { label: "Place dock", text: "Click the map to set the docking station" },
  };

  $: hint = hints[$activeTool];
</script>

{#if hint}
  <div
    transition:fly={{ y: -10, duration: 160 }}
    class="glass flex items-center gap-2 rounded-full px-4 py-1.5 text-xs shadow-glass"
  >
    <span class="material-symbols-outlined text-accent" style="font-size:16px">info</span>
    <span class="font-semibold">{hint.label}</span>
    <span class="text-muted">— {hint.text}</span>
    <button class="chip transition-colors hover:text-ink" on:click={() => setTool("none")}>
      Esc
    </button>
  </div>
{/if}
