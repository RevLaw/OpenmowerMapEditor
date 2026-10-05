<script>
  import { activeTool, setTool, toggleTool, snapEnabled } from "../lib/stores/tools.js";
  import { history } from "../lib/stores/editor.js";
  import { undo, redo, removePoint } from "../lib/actions.js";

  // Map-editing tools only. Robot motion (Start/Stop/Home) lives in the status
  // HUD so editing and moving a real robot never share a button cluster.
  const GROUPS = [
    [
      { id: "none", icon: "near_me", label: "Select / drag (V)" },
      { id: "multi", icon: "select_all", label: "Multi-select (M)" },
      { id: "add", icon: "add_location_alt", label: "Add point (A)" },
      { id: "brush", icon: "blur_circular", label: "Push brush (B)" },
      { id: "snap", icon: "horizontal_rule", label: "Straighten line (S)" },
      { id: "move", icon: "open_with", label: "Move whole zone (G)" },
    ],
    [
      { id: "poly", icon: "polyline", label: "Draw polygon (P)" },
      { id: "rect", icon: "crop_square", label: "Draw rectangle (R)" },
      { id: "circle", icon: "circle", label: "Draw circle (O)" },
      { id: "split", icon: "content_cut", label: "Split zone (X)" },
      { id: "ruler", icon: "straighten", label: "Measure distance (D)" },
    ],
  ];

  function pick(id) {
    if (id === "none") setTool("none");
    else toggleTool(id);
  }
</script>

<!-- 2-column grid; a divider spans both columns (grid-column:1/-1), which
     always forces a new row, keeping the groups visually separated. -->
<div class="glass grid grid-cols-2 gap-1 rounded-2xl p-1.5">
  {#each GROUPS as group, gi}
    {#if gi > 0}
      <div class="my-1 h-px" style="grid-column:1/-1;background:var(--edge-soft)"></div>
    {/if}
    {#each group as t}
      <div class="hicon">
        <button
          class="tool-btn"
          class:active={$activeTool === t.id}
          aria-label={t.label}
          aria-pressed={$activeTool === t.id}
          onclick={() => pick(t.id)}
        >
          <span class="material-symbols-outlined" style="font-size:22px">{t.icon}</span>
        </button>
        <span class="hicon-label">{t.label}</span>
      </div>
    {/each}
  {/each}

  <div class="hicon">
    <button
      class="tool-btn"
      class:toggled={$snapEnabled}
      aria-label="Snap to other zones (hold Alt to bypass)"
      aria-pressed={$snapEnabled}
      onclick={() => snapEnabled.update((v) => !v)}
    >
      <span class="material-symbols-outlined" style="font-size:22px">{$snapEnabled ? "adjust" : "radio_button_unchecked"}</span>
    </button>
    <span class="hicon-label">Snapping {$snapEnabled ? "on" : "off"} (Alt bypasses)</span>
  </div>

  <div class="my-1 h-px" style="grid-column:1/-1;background:var(--edge-soft)"></div>

  <div class="hicon" style="grid-column:1/-1">
    <button class="tool-btn danger" aria-label="Remove selected point (Del)" onclick={removePoint}>
      <span class="material-symbols-outlined" style="font-size:22px">delete</span>
    </button>
    <span class="hicon-label">Remove point (Del)</span>
  </div>

  <div class="my-1 h-px" style="grid-column:1/-1;background:var(--edge-soft)"></div>

  <div class="hicon">
    <button class="tool-btn" disabled={!$history.canUndo} aria-label="Undo (Ctrl+Z)" onclick={undo}>
      <span class="material-symbols-outlined" style="font-size:22px">undo</span>
    </button>
    <span class="hicon-label">Undo (Ctrl+Z)</span>
  </div>
  <div class="hicon">
    <button class="tool-btn" disabled={!$history.canRedo} aria-label="Redo (Ctrl+Shift+Z)" onclick={redo}>
      <span class="material-symbols-outlined" style="font-size:22px">redo</span>
    </button>
    <span class="hicon-label">Redo (Ctrl+Shift+Z)</span>
  </div>
</div>

<style>
  .tool-btn.toggled {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
</style>
