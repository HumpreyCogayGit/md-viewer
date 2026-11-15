// Line-based scroll synchronisation. The preview marks rendered blocks with their source line; the editor knows
// the pixel top of every source line (measured, so soft-wrapped lines are handled). Mapping goes through the source
// line number in both directions, with linear interpolation between anchors.

/** Fractional 0-based line at pixel offset `y`, given ascending line tops. */
export function lineAtOffset(lineTops, y) {
  if (lineTops.length === 0) return 0;
  if (y <= lineTops[0]) return 0;
  let low = 0;
  let high = lineTops.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineTops[mid] <= y) low = mid;
    else high = mid - 1;
  }
  const next = lineTops[low + 1];
  if (next === undefined || next === lineTops[low]) return low;
  return low + (y - lineTops[low]) / (next - lineTops[low]);
}

/** Pixel offset of a fractional line, given ascending line tops. */
export function offsetOfLineIndex(lineTops, line) {
  if (lineTops.length === 0) return 0;
  const whole = Math.max(0, Math.min(lineTops.length - 1, Math.floor(line)));
  const fraction = line - whole;
  const next = lineTops[whole + 1] ?? lineTops[whole];
  return lineTops[whole] + (next - lineTops[whole]) * fraction;
}

/**
 * anchors: [{ line, top }] for preview blocks (0-based source line, pixel top), sorted by line.
 * Returns the preview pixel offset that corresponds to a (fractional) source line.
 */
export function previewOffsetForLine(anchors, line, contentHeight = Infinity) {
  if (anchors.length === 0) return 0;
  let before = anchors[0];
  let after = null;
  for (const anchor of anchors) {
    if (anchor.line <= line) before = anchor;
    else {
      after = anchor;
      break;
    }
  }
  if (line < anchors[0].line) return Math.max(0, anchors[0].top * (line / Math.max(anchors[0].line, 1)));
  if (!after) return Math.min(contentHeight, before.top);
  const span = after.line - before.line || 1;
  return before.top + ((after.top - before.top) * (line - before.line)) / span;
}

/** Inverse: fractional source line for a preview pixel offset. */
export function lineForPreviewOffset(anchors, y) {
  if (anchors.length === 0) return 0;
  let before = anchors[0];
  let after = null;
  for (const anchor of anchors) {
    if (anchor.top <= y) before = anchor;
    else {
      after = anchor;
      break;
    }
  }
  if (y < anchors[0].top) return anchors[0].line * (y / Math.max(anchors[0].top, 1));
  if (!after) return before.line;
  const span = after.top - before.top || 1;
  return before.line + ((after.line - before.line) * (y - before.top)) / span;
}

/** Collect anchors from rendered elements carrying data-sl (1-based source line). */
export function collectAnchors(container) {
  if (!container) return [];
  const base = container.getBoundingClientRect().top - container.scrollTop;
  const seen = new Set();
  const anchors = [];
  for (const element of container.querySelectorAll('[data-sl]')) {
    const line = Number(element.getAttribute('data-sl')) - 1;
    if (seen.has(line)) continue;
    seen.add(line);
    anchors.push({ line, top: element.getBoundingClientRect().top - base });
  }
  return anchors
    .sort((a, b) => a.line - b.line || a.top - b.top)
    .filter((anchor, index, all) => index === 0 || anchor.top >= all[index - 1].top);
}
