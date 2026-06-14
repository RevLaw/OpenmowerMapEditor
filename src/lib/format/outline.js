// Outline helpers. An OpenMower outline is a CLOSED ring of {x,y} points
// where the last point duplicates the first. "Editable points" are the ring
// without that trailing duplicate. Tools operate on editable points and the
// ring is re-closed with closeLoop(). Ported from app.js semantics.

/** Is the outline a closed ring (first point === last point)? */
export function isClosedLoop(outline) {
  if (!outline || outline.length < 2) return false;
  const first = outline[0];
  const last = outline[outline.length - 1];
  return first.x === last.x && first.y === last.y;
}

/** Number of editable (non-duplicate) points. */
export function editableCount(outline) {
  if (!outline) return 0;
  return isClosedLoop(outline) ? Math.max(0, outline.length - 1) : outline.length;
}

/** Editable points as a fresh array of copies. */
export function getEditablePoints(outline) {
  const n = editableCount(outline);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ x: outline[i].x, y: outline[i].y });
  }
  return out;
}

/** Build a closed ring from an array of (open) editable points. Pure. */
export function closeLoop(points) {
  if (!points || points.length === 0) return [];
  const ring = points.map((p) => ({ x: p.x, y: p.y }));
  if (ring.length > 1) {
    ring.push({ x: ring[0].x, y: ring[0].y });
  }
  return ring;
}

/**
 * Clamp a raw point index to a valid editable index (wrapping the closure
 * duplicate back to 0), mirroring app.js toEditableIndex.
 */
export function toEditableIndex(rawIndex, outline) {
  if (rawIndex == null) return null;
  const count = editableCount(outline);
  if (count === 0) return null;
  if (rawIndex >= count) return 0;
  if (rawIndex < 0) return null;
  return rawIndex;
}
