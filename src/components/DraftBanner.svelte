<script>
  import { fly } from "svelte/transition";
  import { pendingDraft } from "../lib/stores/draft.js";
  import { restoreDraft, discardPendingDraft } from "../lib/actions.js";
  import { relativeTime } from "../lib/summary.js";

  let when = $derived($pendingDraft ? new Date($pendingDraft.savedAt) : null);
</script>

{#if $pendingDraft}
  <div
    class="glass flex max-w-[min(92vw,520px)] flex-wrap items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm"
    style="border-color:var(--warn)"
    transition:fly={{ y: -12, duration: 180 }}
    role="alert"
  >
    <span class="material-symbols-outlined" style="font-size:20px;color:var(--warn)">history_edu</span>
    <span class="min-w-0 flex-1">
      <span class="font-semibold">Unsaved draft found</span>
      <span class="block text-[11px] text-subtle" title={when?.toLocaleString()}>
        Edits from {relativeTime(when)} were never saved to the robot.
      </span>
    </span>
    <button class="btn !py-1 text-xs" onclick={discardPendingDraft}>Discard</button>
    <button class="btn btn-accent !py-1 text-xs" onclick={restoreDraft}>Restore</button>
  </div>
{/if}
