// Go-to route planning in map meters: the shortest path from the robot to a
// target that stays inside the drivable zones (mow + nav) and keeps
// `clearance` from every border and obstacle zone. Visibility graph over the
// region's corners (pushed out into free space) + A*. No DOM, no Leaflet.
import polygonClipping from "polygon-clipping";
import { toRing, fromRing } from "./boolean.js";
import {
  distance,
  isPointInsidePolygon,
  offsetPolygon,
  pointToSegmentDistance,
  segmentsIntersect,
  simplify,
} from "./geometry.js";

export const DEFAULT_CLEARANCE = 0.35; // m — robot half-width + a buffer
const DRIVABLE_TYPES = new Set(["mow", "nav"]);
const NODE_PUSH = 1.1; // corner nodes sit a little beyond the clearance
const NODE_SIMPLIFY_M = 0.1;
const EPS = 1e-6;

function usable(zone) {
  return Array.isArray(zone?.points) && zone.points.length >= 3;
}

function polygonsOf(zones, test) {
  return zones.filter((z) => usable(z) && test(z.type)).map((z) => [toRing(z.points)]);
}

// Union of mow + nav zones minus obstacle zones, holes kept (boolean.js drops
// holes because map.json can't store them; here obstacles *are* holes).
function buildRegion(zones) {
  const drivable = polygonsOf(zones, (t) => DRIVABLE_TYPES.has(t));
  if (!drivable.length) return null;
  let multi = polygonClipping.union(...drivable);
  const obstacles = polygonsOf(zones, (t) => t === "obstacle");
  if (obstacles.length) multi = polygonClipping.difference(multi, ...obstacles);
  const polygons = multi.map((poly) => poly.map(fromRing).filter((r) => r.length >= 3)).filter((p) => p.length);
  if (!polygons.length) return null;
  const edges = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        edges.push({
          a,
          b,
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxY: Math.max(a.y, b.y),
        });
      }
    }
  }
  return { polygons, edges };
}

function insideRegion(p, region) {
  return region.polygons.some(
    ([outer, ...holes]) => isPointInsidePolygon(p, outer) && !holes.some((h) => isPointInsidePolygon(p, h))
  );
}

function pointFree(p, region, clearance) {
  if (!insideRegion(p, region)) return false;
  return region.edges.every((e) => pointToSegmentDistance(p, e.a, e.b) >= clearance - EPS);
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b)
  );
}

// Borders already closer than `clearance` to `exempt` (the robot) only have to
// keep their current distance, so a robot parked near an edge can still drive
// away from it — but never closer to it.
function segmentFree(a, b, region, clearance, exempt) {
  const minX = Math.min(a.x, b.x) - clearance;
  const maxX = Math.max(a.x, b.x) + clearance;
  const minY = Math.min(a.y, b.y) - clearance;
  const maxY = Math.max(a.y, b.y) + clearance;
  for (const e of region.edges) {
    if (e.maxX < minX || e.minX > maxX || e.maxY < minY || e.minY > maxY) continue;
    const needed = exempt ? Math.min(clearance, pointToSegmentDistance(exempt, e.a, e.b)) : clearance;
    if (segmentDistance(a, b, e.a, e.b) < needed - EPS) return false;
  }
  return true;
}

function cornerNodes(region, clearance) {
  const push = clearance * NODE_PUSH;
  const nodes = [];
  for (const poly of region.polygons) {
    poly.forEach((ring, k) => {
      // offsetPolygon: positive = inward. Outer rings shrink into the region,
      // holes (obstacles) grow out into it. Miter spikes are harmless — every
      // node is validated here and every edge in segmentFree.
      for (const p of offsetPolygon(simplify(ring, NODE_SIMPLIFY_M), k === 0 ? push : -push)) {
        if (pointFree(p, region, clearance)) nodes.push(p);
      }
    });
  }
  return nodes;
}

// A* from nodes[0] (start) to nodes[1] (target); edges are tested lazily, only
// when they would improve a node, so the direct start → target edge goes first.
function shortestPath(nodes, region, clearance) {
  const n = nodes.length;
  const g = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const closed = new Array(n).fill(false);
  const open = new Set([0]);
  g[0] = 0;
  while (open.size) {
    let u = -1;
    let best = Infinity;
    for (const i of open) {
      const f = g[i] + distance(nodes[i], nodes[1]);
      if (f < best) {
        best = f;
        u = i;
      }
    }
    if (u === 1) break;
    open.delete(u);
    closed[u] = true;
    for (let v = 1; v < n; v += 1) {
      if (closed[v]) continue;
      const cand = g[u] + distance(nodes[u], nodes[v]);
      if (cand >= g[v]) continue;
      if (!segmentFree(nodes[u], nodes[v], region, clearance, u === 0 ? nodes[0] : null)) continue;
      g[v] = cand;
      prev[v] = u;
      open.add(v);
    }
  }
  if (!Number.isFinite(g[1])) return null;
  const waypoints = [];
  for (let i = 1; i !== 0; i = prev[i]) waypoints.unshift(nodes[i]);
  return { waypoints, length: g[1] };
}

/**
 * Plan a go-to route. `zones` = [{ type, points }] in map meters. Returns
 * { ok, waypoints (excluding start, ending at target), length } or { ok: false, reason }.
 */
export function planRoute(zones, start, target, { clearance = DEFAULT_CLEARANCE } = {}) {
  const list = zones || [];
  const region = buildRegion(list);
  if (!region) return { ok: false, reason: "no-drivable-area" };
  if (!insideRegion(start, region)) return { ok: false, reason: "start-outside" };
  if (!insideRegion(target, region)) {
    const inDrivable = list.some((z) => usable(z) && DRIVABLE_TYPES.has(z.type) && isPointInsidePolygon(target, z.points));
    return { ok: false, reason: inDrivable ? "target-blocked" : "target-outside" };
  }
  if (!pointFree(target, region, clearance)) return { ok: false, reason: "target-blocked" };
  const nodes = [{ x: start.x, y: start.y }, { x: target.x, y: target.y }, ...cornerNodes(region, clearance)];
  const found = shortestPath(nodes, region, clearance);
  return found ? { ok: true, ...found } : { ok: false, reason: "no-route" };
}
