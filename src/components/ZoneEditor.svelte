<script>
  import { slide } from "svelte/transition";
  import { currentArea, editor } from "../lib/stores/editor.js";
  import { getAreaType, getZoneName } from "../lib/format/mapFormat.js";
  import { currentLocked } from "../lib/stores/zoneView.js";
  import { changeZoneType, renameCurrentZone, moveZoneOrder } from "../lib/actions.js";
  import { notify } from "../lib/stores/toast.js";
  import MowingSettings from "./MowingSettings.svelte";

  // Inline editor for the selected zone, opened with the pencil in the zone
  // list: name, type, list order, id, and (for mow zones) mowing parameters.
  const TYPES = [
    { id: "mow", label: "Mow", color: "#22c55e" },
    { id: "obstacle", label: "Obstacle", color: "#ef4444" },
    { id: "nav", label: "Nav", color: "#38bdf8" },
  ];

  let { onClose = () => {} } = $props();

  // Read $currentArea / $editor directly: zones are mutated in place.
  let index = $derived($editor.areaIndex);
  let count = $derived($editor.mapData?.areas?.length ?? 0);
  let type = $derived(getAreaType($currentArea));
  let id = $derived($currentArea?.id ?? "");
  let currentName = $derived($currentArea?.properties?.name?.trim() ?? "");

  let nameDraft = $state("");
  let editingName = $state(false);
  $effect.pre(() => {
    if ($currentArea && !editingName) nameDraft = currentName;
  });

  function commitName() {
    editingName = false;
    // Only commit a real change (avoid a no-op undo entry).
    if ($currentArea && nameDraft.trim() !== currentName) renameCurrentZone(nameDraft);
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      notify("Zone id copied.", "info", 1600);
    } catch (_e) {
      notify(`Zone id: ${id}`, "info");
    }
  }
</script>

{#if $currentArea}
  <div class="editor" transition:slide={{ duration: 150 }}>
    {#if $currentLocked}
      <p class="mb-1.5 flex items-center gap-1.5 text-[11px]" style="color:var(--warn)">
        <span class="material-symbols-outlined" style="font-size:15px">lock</span>
        Locked — unlock it to edit.
      </p>
    {/if}

    <input
      class="input name !mt-0"
      aria-label="Zone name"
      placeholder={getZoneName($currentArea, index)}
      disabled={$currentLocked}
      bind:value={nameDraft}
      onfocus={() => (editingName = true)}
      onblur={commitName}
      onkeydown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          editingName = false;
          nameDraft = currentName;
          e.currentTarget.blur();
        }
      }}
    />

    <div class="seg mt-1.5" role="radiogroup" aria-label="Zone type">
      {#each TYPES as t}
        <button
          class="seg-btn"
          class:on={type === t.id}
          style="--c:{t.color}"
          role="radio"
          aria-checked={type === t.id}
          disabled={$currentLocked}
          onclick={() => type !== t.id && changeZoneType(t.id)}
        >
          <span class="dot"></span>
          {t.label}
        </button>
      {/each}
    </div>

    <div class="mt-1.5 flex items-center gap-1 text-[10px] text-subtle">
      <button class="id-chip min-w-0 flex-1" title="Copy zone id" onclick={copyId}>
        <span class="material-symbols-outlined" style="font-size:13px">tag</span>
        <span class="truncate font-mono">{id || "no id"}</span>
        <span class="material-symbols-outlined copy" style="font-size:13px">content_copy</span>
      </button>
      <span class="shrink-0 px-1">#{index + 1}/{count}</span>
      <button class="btn-icon !h-6 !w-6" title="Move up in the list" aria-label="Move zone up" disabled={index <= 0} onclick={() => moveZoneOrder(-1)}>
        <span class="material-symbols-outlined" style="font-size:16px">arrow_upward</span>
      </button>
      <button class="btn-icon !h-6 !w-6" title="Move down in the list" aria-label="Move zone down" disabled={index >= count - 1} onclick={() => moveZoneOrder(1)}>
        <span class="material-symbols-outlined" style="font-size:16px">arrow_downward</span>
      </button>
    </div>

    {#if type === "mow"}
      <div class="section">
        <span class="material-symbols-outlined" style="font-size:13px">grass</span>
        Mowing
      </div>
      <MowingSettings disabled={$currentLocked} />
    {/if}

    <button class="done" onclick={onClose}>
      <span class="material-symbols-outlined" style="font-size:15px">check</span>
      Done
    </button>
  </div>
{/if}

<style>
  .editor {
    margin: 2px 0 6px 10px;
    padding: 8px 8px 6px;
    border-left: 2px solid var(--accent);
    border-radius: 0 10px 10px 0;
    background: color-mix(in srgb, var(--accent) 5%, var(--surface));
  }
  .name {
    font-weight: 600;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--surface-2);
  }
  .seg-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 3px 0;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    color: var(--subtle);
  }
  .seg-btn:hover:not(:disabled) {
    color: var(--ink);
  }
  .seg-btn.on {
    background: var(--surface-3);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 55%, transparent);
  }
  .seg-btn:disabled {
    cursor: not-allowed;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--c);
  }
  .id-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 6px;
    color: var(--subtle);
    text-align: left;
  }
  .id-chip:hover {
    background: var(--surface-2);
    color: var(--muted);
  }
  .id-chip .copy {
    opacity: 0;
  }
  .id-chip:hover .copy {
    opacity: 1;
  }
  .section {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 8px 0 5px;
    padding-top: 7px;
    border-top: 1px solid var(--edge-soft);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--subtle);
  }
  .done {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 8px 0 0 auto;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
  }
  .done:hover {
    background: var(--surface-2);
  }
  @media (pointer: coarse) {
    .seg-btn,
    .done {
      min-height: 40px;
    }
  }
</style>
