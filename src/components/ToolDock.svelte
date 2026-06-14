<script>
  import { activeTool, setTool, toggleTool } from "../lib/stores/tools.js";
  import { history } from "../lib/stores/editor.js";
  import { undo, redo, removePoint } from "../lib/actions.js";

  const tools = [
    { id: "none", icon: "near_me", label: "Select / drag (V)" },
    { id: "add", icon: "add_location_alt", label: "Add point (A)" },
    { id: "brush", icon: "blur_circular", label: "Push brush (B)" },
    { id: "snap", icon: "horizontal_rule", label: "Snap line (S)" },
    { id: "multi", icon: "select_all", label: "Multi-select (M)" },
    { id: "move", icon: "open_with", label: "Move whole zone (G)" },
  ];

  function pick(id) {
    if (id === "none") setTool("none");
    else toggleTool(id);
  }
</script>

<div class="glass flex flex-col gap-1 rounded-2xl p-1.5">
  {#each tools as t}
    <button
      class="tool-btn"
      class:active={$activeTool === t.id}
      title={t.label}
      aria-label={t.label}
      on:click={() => pick(t.id)}
    >
      <span class="material-symbols-outlined" style="font-size:22px">{t.icon}</span>
    </button>
  {/each}

  <div class="my-1 h-px" style="background:var(--edge-soft)"></div>

  <button class="tool-btn danger" title="Remove selected point (Del)" on:click={removePoint}>
    <span class="material-symbols-outlined" style="font-size:22px">delete</span>
  </button>

  <div class="my-1 h-px" style="background:var(--edge-soft)"></div>

  <button class="tool-btn" disabled={!$history.canUndo} title="Undo (Ctrl+Z)" on:click={undo}>
    <span class="material-symbols-outlined" style="font-size:22px">undo</span>
  </button>
  <button class="tool-btn" disabled={!$history.canRedo} title="Redo (Ctrl+Shift+Z)" on:click={redo}>
    <span class="material-symbols-outlined" style="font-size:22px">redo</span>
  </button>
</div>
