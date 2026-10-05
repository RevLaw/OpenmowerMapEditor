<script>
  import { tick } from "svelte";
  import { slide } from "svelte/transition";
  import {
    robotTrailSelectedDate,
    robotTrailDataDays,
    selectRobotTrailDate,
    todayDateKey,
  } from "../lib/stores/robotTrail.js";
  import { monthGrid } from "../lib/robot/trailDays.js";

  // Compact month calendar for the movement trail: days with recorded data
  // get a dot, so it's easy to jump to days the robot actually drove.
  let { open = $bindable(false) } = $props();

  const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  let today = $derived(todayDateKey());
  let [selY, selM] = $derived($robotTrailSelectedDate.split("-").map(Number));
  // Month being browsed (independent of the selected day until you pick one).
  let view = $state({ y: 0, m: 0 });
  let calEl = $state();
  $effect.pre(() => {
    if (open) view = { y: selY, m: selM - 1 };
  });
  // The status panel can be height-limited (it scrolls); bring the calendar
  // into view once it has slid open.
  $effect(() => {
    if (open && calEl) tick().then(() => setTimeout(() => calEl?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 160));
  });

  let weeks = $derived(monthGrid(view.y, view.m));
  let title = $derived(new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  let isCurrentMonth = $derived(`${view.y}-${String(view.m + 1).padStart(2, "0")}` >= today.slice(0, 7));
  let monthHasData = $derived(weeks.flat().some((c) => c.inMonth && $robotTrailDataDays.has(c.key)));

  function shiftMonth(delta) {
    const d = new Date(view.y, view.m + delta, 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
  }

  function pick(key) {
    if (key > today) return;
    selectRobotTrailDate(key);
    open = false;
  }
</script>

{#if open}
  <div bind:this={calEl} class="cal mt-1.5" transition:slide={{ duration: 140 }}>
    <div class="mb-1 flex items-center justify-between">
      <button class="btn-icon !h-6 !w-6" title="Previous month" onclick={() => shiftMonth(-1)}>
        <span class="material-symbols-outlined" style="font-size:16px">chevron_left</span>
      </button>
      <span class="text-[11px] font-semibold">{title}</span>
      <button class="btn-icon !h-6 !w-6" title="Next month" disabled={isCurrentMonth} onclick={() => shiftMonth(1)}>
        <span class="material-symbols-outlined" style="font-size:16px">chevron_right</span>
      </button>
    </div>
    <div class="grid grid-cols-7 gap-px text-center">
      {#each WEEKDAYS as w}
        <span class="pb-0.5 text-[9px] font-semibold uppercase text-subtle">{w}</span>
      {/each}
      {#each weeks as week}
        {#each week as c (c.key)}
          {@const hasData = $robotTrailDataDays.has(c.key)}
          <button
            class="day"
            class:out={!c.inMonth}
            class:data={hasData}
            class:today={c.key === today}
            class:sel={c.key === $robotTrailSelectedDate}
            disabled={c.key > today}
            title={hasData ? `${c.key} — trail recorded` : c.key}
            onclick={() => pick(c.key)}
          >
            {c.day}
            {#if hasData}<span class="dot"></span>{/if}
          </button>
        {/each}
      {/each}
    </div>
    <div class="mt-1 flex items-center justify-between text-[9px] text-subtle">
      <span class="flex items-center gap-1"><span class="dot static"></span>{monthHasData ? "trail recorded" : "no trail this month"}</span>
      <button class="text-accent hover:underline" onclick={() => pick(today)}>Today</button>
    </div>
  </div>
{/if}

<style>
  .cal {
    padding: 6px;
    border-radius: 10px;
    background: var(--surface-2);
    border: 1px solid var(--glass-edge);
  }
  .day {
    position: relative;
    height: 26px;
    border-radius: 6px;
    font-size: 11px;
    color: var(--subtle);
  }
  .day.data {
    color: var(--ink);
    font-weight: 600;
  }
  .day.out {
    opacity: 0.35;
  }
  .day:hover:not(:disabled) {
    background: var(--surface-3);
  }
  .day:disabled {
    opacity: 0.2;
    cursor: default;
  }
  .day.today {
    box-shadow: inset 0 0 0 1px var(--edge);
  }
  .day.sel {
    background: var(--accent);
    color: #04121f;
  }
  .dot {
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--ok);
  }
  .day.sel .dot {
    background: #04121f;
  }
  .dot.static {
    position: static;
    margin: 0;
    display: inline-block;
  }
  @media (pointer: coarse) {
    .day {
      height: 36px;
    }
  }
</style>
