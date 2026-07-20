// Pure planar geometry helpers operating on {x,y} points in meters.
// No DOM / Leaflet dependencies so they are unit-testable in node.

/** Euclidean distance between two metric points. */
export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Ray-casting point-in-polygon test (ported from app.js). */
export function isPointInsidePolygon(point, polygon) {
  if (!point || !polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Absolute area of a polygon via the shoelace formula (m²). */
export function polygonArea(polygon) {
  if (!polygon || polygon.length < 3) return 0;
  let areaTwice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const j = (i + 1) % polygon.length;
    areaTwice += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
  }
  return Math.abs(areaTwice) / 2;
}

/** Perimeter length (m) of an outline. Treats it as a closed ring. */
export function polygonPerimeter(polygon) {
  if (!polygon || polygon.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const j = (i + 1) % polygon.length;
    total += distance(polygon[i], polygon[j]);
  }
  return total;
}

/** Arithmetic centroid (average of vertices) of a polygon. */
export function centroid(polygon) {
  if (!polygon || polygon.length === 0) return null;
  let x = 0;
  let y = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    x += polygon[i].x;
    y += polygon[i].y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
}

/**
 * Of all `mow` areas that contain `point`, return the index of the smallest
 * (most specific) one — used to link obstacles to their parent mow area.
 * @param {{x:number,y:number}} point
 * @param {Array} areas  the map's areas array
 * @param {(area:any)=>string} getType  accessor for an area's type
 */
export function bestContainingMowAreaIndex(point, areas, getType) {
  if (!Array.isArray(areas) || !point) return null;
  let bestIndex = null;
  let bestSize = Number.POSITIVE_INFINITY;
  for (let i = 0; i < areas.length; i += 1) {
    const area = areas[i];
    if (getType(area) !== "mow" || !area.outline?.length) continue;
    if (!isPointInsidePolygon(point, area.outline)) continue;
    const size = polygonArea(area.outline);
    if (size < bestSize) {
      bestSize = size;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Do open segments p1-p2 and p3-p4 properly cross?
 * Returns false for shared endpoints / collinear touching (so adjacent
 * polygon edges are not flagged). Used by self-intersection validation.
 */
export function segmentsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  return false;
}

/** Shortest distance from point p to segment a-b. */
export function pointToSegmentDistance(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const lenSq = vx * vx + vy * vy;
  let t = lenSq > 0 ? (wx * vx + wy * vy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + t * vx);
  const dy = p.y - (a.y + t * vy);
  return Math.hypot(dx, dy);
}

/**
 * For a closed ring of editable points, return the array index at which a new
 * vertex should be spliced so it lands on the edge nearest to `p`.
 * (Insert between the two consecutive vertices of that edge.)
 */
export function nearestEdgeInsertIndex(points, p) {
  if (!points || points.length < 2) return points ? points.length : 0;
  const n = points.length;
  let best = Number.POSITIVE_INFINITY;
  let bestI = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const d = pointToSegmentDistance(p, a, b);
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  return bestI + 1; // splice position after vertex bestI
}

export function translatePoints(points, dx, dy) {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function rotatePoints(points, center, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return points.map((p) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
  });
}

export function scalePoints(points, center, factor) {
  return points.map((p) => ({
    x: center.x + (p.x - center.x) * factor,
    y: center.y + (p.y - center.y) * factor,
  }));
}

/** Axis-aligned bounding box of a point set. */
export function boundingBox(points) {
  if (!points || !points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Principal-axis orientation of a point set, in degrees (PCA). Robust for the
 * dense outlines OpenMower records. Used as the base direction for "relative"
 * mowing-angle preview (mow_angle_offset_is_absolute = false).
 */
export function principalAngleDeg(points) {
  const n = points?.length || 0;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
}

/**
 * OpenMower's auto mow orientation: the direction (radians) of the first
 * outline segment that reaches >= minDist meters from the start point. Returns
 * 0 if no such point (matches MowingBehavior's default). East (+x) = 0.
 */
export function firstSegmentAngle(points, minDist = 2) {
  if (!points || points.length < 2) return 0;
  const p0 = points[0];
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - p0.x;
    const dy = points[i].y - p0.y;
    if (Math.hypot(dx, dy) >= minDist) return Math.atan2(dy, dx);
  }
  return 0;
}

function lineIntersect(p1, d1, p2, d2) {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * Offset a closed polygon inward by `dist` (negative = outward) using miter
 * joins. Approximate (can self-intersect on complex concave shapes) — used for
 * the "perimeter laps" coverage preview. Winding is auto-detected.
 */
export function offsetPolygon(points, dist) {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  let area2 = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    area2 += a.x * b.y - b.x * a.y;
  }
  const ccw = area2 > 0;
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) {
      lines.push(null);
      continue;
    }
    dx /= len;
    dy /= len;
    // inward normal: left of edge for CCW, right for CW
    const nx = ccw ? -dy : dy;
    const ny = ccw ? dx : -dx;
    lines.push({ p: { x: a.x + nx * dist, y: a.y + ny * dist }, d: { x: dx, y: dy } });
  }
  const result = [];
  for (let i = 0; i < n; i += 1) {
    const cur = lines[i];
    let prev = lines[(i - 1 + n) % n];
    let k = (i - 1 + n) % n;
    while (!prev && k !== i) {
      k = (k - 1 + n) % n;
      prev = lines[k];
    }
    if (!prev || !cur) {
      result.push({ x: points[i].x, y: points[i].y });
      continue;
    }
    const x = lineIntersect(prev.p, prev.d, cur.p, cur.d);
    result.push(x || { x: cur.p.x, y: cur.p.y });
  }
  return result;
}

/**
 * Ramer–Douglas–Peucker simplification of an open point list, preserving the
 * first and last vertices. Used to reduce vertex count of a zone outline while
 * keeping its shape. Never returns fewer than 3 points.
 */
export function simplify(points, tolerance) {
  if (!points || points.length <= 3 || tolerance <= 0) {
    return points ? points.map((p) => ({ x: p.x, y: p.y })) : [];
  }

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = pointToSegmentDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  const result = points.filter((_, i) => keep[i]).map((p) => ({ x: p.x, y: p.y }));
  return result.length >= 3 ? result : points.map((p) => ({ x: p.x, y: p.y }));
}

