<script>
  import { untrack } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { saveDialog } from "../lib/stores/ui.js";
  import { editor } from "../lib/stores/editor.js";
  import { savedSnapshot } from "../lib/stores/dirty.js";
  import { validateNow } from "../lib/stores/validation.js";
  import { diffMaps } from "../lib/diff.js";
  import { saveCurrent, exportMap } from "../lib/actions.js";

  const TYPE_DOT = { mow: "#22c55e", obstacle: "#ef4444", nav: "#38bdf8" };

  let diff = $state(null);
  let issues = $state([]);
  let restart = $state(false);
  let saving = $state(false);

  // Snapshot the diff + validation once per opening (not live while open).
  $effect.pre(() => {
    const d = $saveDialog;
    if (!d) return;
    untrack(() => {
      restart = Boolean(d.restart);
      diff = diffMaps($savedSnapshot, $editor.mapData);
      issues = validateNow();
    });
  });

  let errors = $derived(issues.filter((i) => i.severity === "error"));
  let warnings = $derived(issues.filter((i) => i.severity !== "error"));

  function close() {
    if (!saving) saveDialog.set(null);
  }

  async function confirm() {
    saving = true;
    try {
      await saveCurrent({ restart });
    } finally {
      saving = false;
      saveDialog.set(null);
    }
  }

  function onKey(e) {
    if (!$saveDialog) return;
    if (e.key === "Escape") close();
    else if (e.key === "Enter" && !e.target?.matches?.("input,textarea,select")) {
      e.preventDefault();
      confirm();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if $saveDialog && diff}
  <div
    class="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4"
    onclick={close}
    transition:fade={{ duration: 120 }}
    role="presentation"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
    <div
      class="glass glass-strong flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl"
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 140, start: 0.97 }}
      role="dialog"
      tabindex="-1"
      aria-label="Save map"
    >
      <header class="flex items-center justify-between border-b px-4 py-3" style="border-color:var(--edge-soft)">
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <span class="material-symbols-outlined" style="font-size:18px">save</span>
          Save map to the robot
        </h2>
        <button class="btn-icon" onclick={close} aria-label="Close">
          <span class="material-symbols-outlined" style="font-size:20px">close</span>
        </button>
      </header>

      <div class="scroll-thin flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <section>
          <h3 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
            Changes since last load / save
          </h3>
          {#if diff.empty}
            <p class="text-[12px] text-subtle">No changes — saving writes the same map again.</p>
          {:else}
            <ul class="space-y-1 text-[12px]">
              {#each diff.added as z}
                <li class="flex items-center gap-2">
                  <span class="chip !px-1.5" style="color:var(--ok)">+ added</span>
                  <span class="h-2 w-2 rounded-full" style="background:{TYPE_DOT[z.type] || '#94a3b8'}"></span>
                  <span class="truncate">{z.label}</span>
                </li>
              {/each}
              {#each diff.removed as z}
                <li class="flex items-center gap-2">
                  <span class="chip !px-1.5" style="color:var(--danger)">− removed</span>
                  <span class="h-2 w-2 rounded-full" style="background:{TYPE_DOT[z.type] || '#94a3b8'}"></span>
                  <span class="truncate">{z.label}</span>
                </li>
              {/each}
              {#each diff.changed as z}
                <li class="flex items-start gap-2">
                  <span class="chip !px-1.5" style="color:var(--warn)">~ edited</span>
                  <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" style="background:{TYPE_DOT[z.type] || '#94a3b8'}"></span>
                  <span class="min-w-0">
                    <span class="block truncate">{z.label}</span>
                    <span class="block text-[11px] text-subtle">{z.changes.join(" · ")}</span>
                  </span>
                </li>
              {/each}
              {#if diff.reordered}
                <li class="text-[11px] text-subtle">Zone order changed.</li>
              {/if}
              {#if diff.dock}
                <li class="text-[11px] text-subtle">{diff.dock[0].toUpperCase() + diff.dock.slice(1)}.</li>
              {/if}
              {#if diff.projectionChanged}
                <li class="text-[11px] text-subtle">Projection origin changed.</li>
              {/if}
            </ul>
          {/if}
        </section>

        <section>
          <h3 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">Checks</h3>
          {#if !issues.length}
            <p class="flex items-center gap-1.5 text-[12px]" style="color:var(--ok)">
              <span class="material-symbols-outlined" style="font-size:16px">check_circle</span>
              No geometry problems detected.
            </p>
          {:else}
            <ul class="space-y-1">
              {#each [...errors, ...warnings] as issue (issue.id)}
                <li class="flex items-start gap-1.5 text-[12px] leading-snug">
                  <span
                    class="material-symbols-outlined mt-px"
                    style="font-size:15px;color:{issue.severity === 'error' ? 'var(--danger)' : 'var(--warn)'}"
                  >{issue.severity === "error" ? "error" : "warning"}</span>
                  <span class="text-muted">{issue.message}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <label class="flex items-start gap-2 text-[12px]">
          <input type="checkbox" class="mt-0.5 accent-[var(--accent)]" bind:checked={restart} />
          <span>
            Restart ROS after saving
            <span class="block text-[11px] text-subtle">OpenMower only reads map.json on start-up.</span>
          </span>
        </label>
      </div>

      <footer class="flex items-center gap-2 border-t px-4 py-3" style="border-color:var(--edge-soft)">
        <button class="btn !px-2.5" title="Download map.json instead" onclick={() => exportMap("json")}>
          <span class="material-symbols-outlined" style="font-size:18px">download</span>
        </button>
        <div class="flex-1"></div>
        <button class="btn" onclick={close} disabled={saving}>Cancel</button>
        <button class={errors.length ? "btn btn-warn" : "btn btn-accent"} onclick={confirm} disabled={saving}>
          <span class="material-symbols-outlined" style="font-size:18px">{restart ? "restart_alt" : "save"}</span>
          {saving ? "Saving…" : errors.length ? "Save anyway" : restart ? "Save + restart" : "Save"}
        </button>
      </footer>
    </div>
  </div>
{/if}
