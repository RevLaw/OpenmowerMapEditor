<script>
  import { getAreaType } from "../lib/format/mapFormat.js";
  import { getEditablePoints } from "../lib/format/outline.js";

  export let map;
  export let size = 96;

  const STROKE = { mow: "#e5e7eb", obstacle: "#ef4444", nav: "#38bdf8" };
  const PAD = 0.1;

  function build(m) {
    const areas = m?.areas || [];
    const raw = [];
    const all = [];
    for (const a of areas) {
      const ep = getEditablePoints(a.outline || []);
      if (ep.length < 2) continue;
      raw.push({ type: getAreaType(a), pts: ep });
      all.push(...ep);
    }
    const dock = m?.docking_stations?.[0]?.position;
    if (dock) all.push(dock);
    if (!all.length) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of all) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const w = Math.max(maxX - minX, 1e-3);
    const h = Math.max(maxY - minY, 1e-3);
    const scale = Math.min((size * (1 - 2 * PAD)) / w, (size * (1 - 2 * PAD)) / h);
    const offX = (size - scale * w) / 2;
    const offY = (size - scale * h) / 2;
    const tx = (x) => offX + (x - minX) * scale;
    const ty = (y) => size - (offY + (y - minY) * scale); // flip Y (north up)

    return {
      polys: raw.map((p) => ({
        type: p.type,
        d: p.pts.map((pt) => `${tx(pt.x).toFixed(1)},${ty(pt.y).toFixed(1)}`).join(" "),
      })),
      dock: dock ? { cx: tx(dock.x).toFixed(1), cy: ty(dock.y).toFixed(1) } : null,
    };
  }

  $: data = build(map);
</script>

{#if data}
  <svg
    viewBox="0 0 {size} {size}"
    width={size}
    height={size}
    class="shrink-0 rounded-lg"
    style="background:#0a111e;border:1px solid var(--edge-soft)"
  >
    {#each data.polys as poly}
      <polygon
        points={poly.d}
        fill="none"
        stroke={STROKE[poly.type] || "#94a3b8"}
        stroke-width="1"
        stroke-linejoin="round"
        opacity="0.95"
      />
    {/each}
    {#if data.dock}
      <circle cx={data.dock.cx} cy={data.dock.cy} r="2.6" fill="#fb923c" />
    {/if}
  </svg>
{:else}
  <div
    class="grid shrink-0 place-items-center rounded-lg text-[10px] text-subtle"
    style="width:{size}px;height:{size}px;background:#0a111e;border:1px solid var(--edge-soft)"
  >
    no zones
  </div>
{/if}
