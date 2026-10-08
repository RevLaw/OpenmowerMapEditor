<script>
  import { fade } from "svelte/transition";
  import Collapsible from "../Collapsible.svelte";
  import CaptureToggleHeader from "../CaptureToggleHeader.svelte";
  import OverlayToggleRow from "../OverlayToggleRow.svelte";
  import TrailCalendar from "../TrailCalendar.svelte";
  import {
    clearRobotTrailHistory,
    robotTrailDisplayPoints,
    robotTrailEnabled,
    robotTrailHistoryEnabled,
    robotTrailHistoryPoints,
    robotTrailHistoryStorage,
    robotTrailSelectedDate,
    selectRobotTrailDate,
    setRobotTrailEnabled,
    setRobotTrailHistoryEnabled,
    todayDateKey,
    robotTrailDataDays,
    jumpToRobotTrailDataDay,
  } from "../../lib/stores/robotTrail.js";
  import { adjacentDataDay } from "../../lib/robot/trailDays.js";
  import { confirmAndNotify } from "../../lib/stores/toast.js";
  import { formatBytes } from "../../lib/measurements.js";

  let today = $derived(todayDateKey());
  let isViewingToday = $derived($robotTrailSelectedDate === today);
  // Server truth, not the client-only Live-robot breadcrumb — capture runs on
  // the mower whether or not Live robot is on.
  let trailCapturing = $derived(Boolean($robotTrailHistoryStorage.collector?.capturing));

  // Trail day picker: a calendar with a dot on days that have data; the
  // arrows skip straight to the previous / next such day.
  let calendarOpen = $state(false);
  let prevDataDay = $derived(adjacentDataDay($robotTrailDataDays, $robotTrailSelectedDate, -1));
  let nextDataDay = $derived(adjacentDataDay($robotTrailDataDays, $robotTrailSelectedDate, 1));
  let selectedLabel = $derived(
    $robotTrailSelectedDate === today
      ? "Today"
      : new Date(`${$robotTrailSelectedDate}T12:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
  );

  function clearSavedTrail() {
    return confirmAndNotify(
      "Clear the mower's saved movement trail for all devices?",
      clearRobotTrailHistory,
      "Saved movement trail cleared.",
      "Could not clear the saved movement trail."
    );
  }
</script>

<Collapsible title="Movement trail" icon="route" key="trail">
  <CaptureToggleHeader
    icon="route"
    label="Record the trail"
    enabled={$robotTrailEnabled}
    toggleTitle="Start/stop recording the mower's movement trail"
    onToggle={() => setRobotTrailEnabled(!$robotTrailEnabled)}
  />

  {#if $robotTrailEnabled}
    <div transition:fade={{ duration: 140 }}>
      <div class="text-[10px] text-subtle">
        {$robotTrailHistoryPoints.length} point{$robotTrailHistoryPoints.length === 1 ? "" : "s"} today ·
        {trailCapturing ? "capturing now" : "not capturing"}
      </div>

      <OverlayToggleRow
        label="Overlay saved history"
        enabled={$robotTrailHistoryEnabled}
        toggleTitle="Overlay the mower's saved movement trail"
        onToggle={() => setRobotTrailHistoryEnabled(!$robotTrailHistoryEnabled)}
        clearTitle="Clear the saved movement trail"
        clearDisabled={!isViewingToday || $robotTrailHistoryPoints.length === 0}
        onClear={clearSavedTrail}
      />

      {#if $robotTrailHistoryEnabled}
        <div transition:fade={{ duration: 140 }} class="mt-1">
          <div class="flex items-center gap-1">
            <button
              class="btn-icon !h-6 !w-6"
              title="Previous day with a recorded trail"
              disabled={!prevDataDay}
              onclick={() => jumpToRobotTrailDataDay(-1)}
            >
              <span class="material-symbols-outlined" style="font-size:16px">chevron_left</span>
            </button>
            <button
              class="date-btn flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md py-0.5 text-[11px]"
              class:open={calendarOpen}
              title="Pick a day — days with a recorded trail have a dot"
              aria-expanded={calendarOpen}
              onclick={() => (calendarOpen = !calendarOpen)}
            >
              <span class="material-symbols-outlined" style="font-size:14px">calendar_month</span>
              <span class="truncate">{selectedLabel}</span>
              {#if $robotTrailDataDays.has($robotTrailSelectedDate)}
                <span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:var(--ok)"></span>
              {/if}
            </button>
            <button
              class="btn-icon !h-6 !w-6"
              title="Next day with a recorded trail"
              disabled={!nextDataDay}
              onclick={() => jumpToRobotTrailDataDay(1)}
            >
              <span class="material-symbols-outlined" style="font-size:16px">chevron_right</span>
            </button>
            <button
              class="btn-icon !h-6 !w-6"
              title="Jump to today"
              disabled={isViewingToday}
              onclick={() => selectRobotTrailDate(today)}
            >
              <span class="material-symbols-outlined" style="font-size:16px">home</span>
            </button>
          </div>
          <TrailCalendar bind:open={calendarOpen} />

          <div class="mt-2 text-[9px] text-subtle">
            {#if $robotTrailDisplayPoints.length > 0}
              {$robotTrailDisplayPoints.length} points
            {:else}
              No mow recorded this day
            {/if}
          </div>
          <div class="mt-1 text-[9px] leading-relaxed text-subtle">
            {$robotTrailHistoryStorage.minDistanceM} m spacing ·
            {Math.round($robotTrailHistoryStorage.flushIntervalMs / 1000)} s disk flush ·
            {formatBytes($robotTrailHistoryStorage.fileBytes)}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</Collapsible>

<style>
  .date-btn {
    color: var(--ink);
    border: 1px solid var(--glass-edge);
  }
  .date-btn:hover,
  .date-btn.open {
    border-color: var(--accent);
  }
</style>
