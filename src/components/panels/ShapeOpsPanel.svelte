<script>
  import Collapsible from "../Collapsible.svelte";
  import { editor, currentArea } from "../../lib/stores/editor.js";
  import { getAreaType } from "../../lib/format/mapFormat.js";
  import { currentLocked } from "../../lib/stores/zoneView.js";
  import {
    zoneOperationTargets,
    mergeWithZone,
    subtractZone,
    clipToZone,
  } from "../../lib/actions.js";

  // Recomputed on every edit ($editor.rev) so "touching" stays accurate —
  // only while the panel is open (it compares borders of every zone pair).
  let open = $state(false);
  let targets = $derived(open && $editor.rev >= 0 && $currentArea ? zoneOperationTargets() : []);
  let target = $state("");
  let type = $derived(getAreaType($currentArea));

  // Default to the most relevant zone: for an obstacle, the mow zone it
  // touches (clip); otherwise the first touching zone. Re-picked whenever the
  // selected zone changes so a choice made for another zone doesn't linger.
  let pickedFor = -1;
  $effect.pre(() => {
    const zoneChanged = pickedFor !== $editor.areaIndex;
    if (zoneChanged || !targets.some((t) => String(t.index) === target)) {
      pickedFor = $editor.areaIndex;
      const preferred =
        (type === "obstacle" && targets.find((t) => t.touching && t.type === "mow")) ||
        targets.find((t) => t.touching) ||
        targets[0];
      target = preferred ? String(preferred.index) : "";
    }
  });

  let disabled = $derived($currentLocked || target === "");
  const run = (fn) => target !== "" && fn(Number(target));
</script>

{#if $currentArea}
  <Collapsible title="Combine zones" icon="join" key="shapeops" bind:open>
    <label class="field">
      With zone
      <select class="select" bind:value={target} disabled={!targets.length}>
        {#if !targets.length}<option value="">No other zones</option>{/if}
        {#each targets as t}
          <option value={String(t.index)}>{t.touching ? "● " : "○ "}{t.label} ({t.type})</option>
        {/each}
      </select>
    </label>
    <p class="-mt-1 mb-2 text-[10px] text-subtle">● overlaps or touches this zone</p>
    <div class="grid grid-cols-3 gap-1.5">
      <button class="btn !px-1 text-xs" {disabled} title="Union: absorb the other zone into this one" onclick={() => run(mergeWithZone)}>
        <span class="material-symbols-outlined" style="font-size:17px">join</span>
        Merge
      </button>
      <button class="btn !px-1 text-xs" {disabled} title="Difference: cut the other zone's shape out of this one" onclick={() => run(subtractZone)}>
        <span class="material-symbols-outlined" style="font-size:17px">join_left</span>
        Cut out
      </button>
      <button class="btn !px-1 text-xs" {disabled} title="Intersection: keep only the part inside the other zone" onclick={() => run(clipToZone)}>
        <span class="material-symbols-outlined" style="font-size:17px">join_inner</span>
        Clip
      </button>
    </div>
  </Collapsible>
{/if}
