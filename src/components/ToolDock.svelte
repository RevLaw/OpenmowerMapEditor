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

<!-- 2-column grid instead of one tall column of 9 — a divider spans both
     grid columns (grid-column:1/-1), which always forces a new row, keeping
     the three groups (tools / delete / undo-redo) visually separated. Grid
     auto-sizes the columns to the buttons' own size, so this doesn't need a
     guessed pixel width the way flex-wrap would. -->
<div class="glass grid grid-cols-2 gap-1 rounded-2xl p-1.5">
  {#each tools as t}
    <div class="hicon">
      <button
        class="tool-btn"
        class:active={$activeTool === t.id}
        aria-label={t.label}
        on:click={() => pick(t.id)}
      >
        <span class="material-symbols-outlined" style="font-size:22px">{t.icon}</span>
      </button>
      <span class="hicon-label">{t.label}</span>
    </div>
  {/each}

  <div class="my-1 h-px" style="grid-column:1/-1;background:var(--edge-soft)"></div>

  <div class="hicon" style="grid-column:1/-1">
    <button class="tool-btn danger" aria-label="Remove selected point (Del)" on:click={removePoint}>
      <span class="material-symbols-outlined" style="font-size:22px">delete</span>
    </button>
    <span class="hicon-label">Remove point (Del)</span>
  </div>

  <div class="my-1 h-px" style="grid-column:1/-1;background:var(--edge-soft)"></div>

  <div class="hicon">
    <button class="tool-btn" disabled={!$history.canUndo} aria-label="Undo (Ctrl+Z)" on:click={undo}>
      <span class="material-symbols-outlined" style="font-size:22px">undo</span>
    </button>
    <span class="hicon-label">Undo (Ctrl+Z)</span>
  </div>
  <div class="hicon">
    <button class="tool-btn" disabled={!$history.canRedo} aria-label="Redo (Ctrl+Shift+Z)" on:click={redo}>
      <span class="material-symbols-outlined" style="font-size:22px">redo</span>
    </button>
    <span class="hicon-label">Redo (Ctrl+Shift+Z)</span>
  </div>
</div>
