<script>
  import { currentArea } from "../../lib/stores/editor.js";
  import { currentLocked } from "../../lib/stores/zoneView.js";
  import { simplifyTolerance } from "../../lib/stores/tools.js";
  import { simplifyZoneAction } from "../../lib/actions.js";
  import Collapsible from "../Collapsible.svelte";

  const fmt = (v) => Number(v).toFixed(2).replace(/\.?0+$/, "");
  let disabled = $derived(!$currentArea || $currentLocked);
</script>

<Collapsible title="Simplify outline" icon="compress" key="transform" open={false}>
  <p class="mb-2 text-[11px] text-subtle">
    Removes points that barely change the shape — handy for dense traced or recorded outlines.
  </p>
  <div class="mb-1 flex items-center justify-between text-xs text-muted">
    <span>Tolerance (m)</span>
    <span class="font-mono text-accent">{fmt($simplifyTolerance)}</span>
  </div>
  <input
    class="slider mb-2"
    type="range"
    min="0.01"
    max="0.5"
    step="0.01"
    bind:value={$simplifyTolerance}
    {disabled}
  />
  <button class="btn w-full" {disabled} onclick={simplifyZoneAction}>
    <span class="material-symbols-outlined" style="font-size:18px">compress</span>
    Simplify outline
  </button>
</Collapsible>
