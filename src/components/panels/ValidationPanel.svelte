<script>
  import { get } from "svelte/store";
  import { editor, setAreaIndex, selectPoint } from "../../lib/stores/editor.js";
  import { validateMap } from "../../lib/validation.js";
  import { getEditablePoints } from "../../lib/format/outline.js";
  import { mapApi } from "../../lib/stores/mapApi.js";

  $: issues = $editor.mapData ? validateMap($editor.mapData) : [];
  $: errors = issues.filter((i) => i.severity === "error").length;
  $: warnings = issues.length - errors;

  function goto(issue) {
    if (issue.areaIndex != null) setAreaIndex(issue.areaIndex);
    const api = get(mapApi);
    const area = get(editor).mapData?.areas?.[issue.areaIndex];
    if (issue.pointIndex != null && area) {
      const pts = getEditablePoints(area.outline || []);
      if (pts[issue.pointIndex]) {
        selectPoint(issue.pointIndex);
        api?.panToPoint(pts[issue.pointIndex]);
        return;
      }
    }
    api?.fitCurrentArea();
  }
</script>

<section class="card">
  <h2 class="card-title justify-between">
    <span class="flex items-center gap-2">
      <span class="material-symbols-outlined" style="font-size:16px">rule</span>
      Validation
    </span>
    {#if issues.length === 0}
      <span class="chip" style="color:var(--ok)">all clear</span>
    {:else}
      <span class="flex gap-1">
        {#if errors}<span class="chip" style="color:var(--danger)">{errors} err</span>{/if}
        {#if warnings}<span class="chip" style="color:var(--warn)">{warnings} warn</span>{/if}
      </span>
    {/if}
  </h2>

  {#if issues.length === 0}
    <p class="text-[11px] text-subtle">No geometry problems detected.</p>
  {:else}
    <ul class="flex flex-col gap-1">
      {#each issues as issue (issue.id)}
        <li>
          <button
            class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] leading-snug transition-colors"
            style="background:var(--surface-2)"
            on:click={() => goto(issue)}
          >
            <span
              class="material-symbols-outlined mt-px"
              style="font-size:15px;color:{issue.severity === 'error' ? 'var(--danger)' : 'var(--warn)'}"
            >
              {issue.severity === "error" ? "error" : "warning"}
            </span>
            <span class="text-muted">{issue.message}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
