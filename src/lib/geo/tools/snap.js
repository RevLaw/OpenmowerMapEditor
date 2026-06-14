// Snap-line tool: redistribute the points between a start and end vertex onto
// a straight, equally spaced line. Walks the ring forward (wrapping) from
// start to end. Pure: operates on open editable-point arrays.

/** Forward (wrapping) index path from startIdx to endIdx inclusive. */
export function buildCircularIndexPath(startIdx, endIdx, count) {
  const path = [startIdx];
  let current = startIdx;
  for (let safety = 0; safety < count; safety += 1) {
    if (current === endIdx) break;
    current = (current + 1) % count;
    path.push(current);
  }
  return path;
}

/**
 * @returns {{points: Array<{x:number,y:number}>, changed: number}}
 */
export function snapEvenly(points, startIdx, endIdx) {
  const count = points.length;
  const result = points.map((p) => ({ x: p.x, y: p.y }));
  if (
    startIdx == null ||
    endIdx == null ||
    startIdx < 0 ||
    endIdx < 0 ||
    startIdx >= count ||
    endIdx >= count ||
    startIdx === endIdx
  ) {
    return { points: result, changed: 0 };
  }

  const indexPath = buildCircularIndexPath(startIdx, endIdx, count);
  if (indexPath.length < 2) return { points: result, changed: 0 };

  const start = { x: result[startIdx].x, y: result[startIdx].y };
  const end = { x: result[endIdx].x, y: result[endIdx].y };
  const segments = indexPath.length - 1;

  for (let step = 0; step < indexPath.length; step += 1) {
    const t = step / segments;
    const idx = indexPath[step];
    result[idx] = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    };
  }

  return { points: result, changed: indexPath.length };
}
