// Rehype plugin: tag block-level elements with their Markdown source position so the app can map preview
// selections and scroll positions back to the source (data-sl = start line, data-so/data-eo = start/end offset).

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'table',
  'tr',
  'hr',
  'ul',
  'ol',
  'div',
  'img',
  'section',
  'dl',
  'details',
]);

export function rehypeSourcePositions() {
  return (tree) => {
    const visit = (node) => {
      if (node.type === 'element' && node.position && BLOCK_TAGS.has(node.tagName)) {
        node.properties = {
          ...node.properties,
          dataSl: node.position.start.line,
          dataSo: node.position.start.offset,
          dataEo: node.position.end.offset,
        };
      }
      if (node.children) node.children.forEach(visit);
    };
    visit(tree);
  };
}

/** Source range covered by the DOM selection, from the nearest tagged ancestors of both ends. */
export function sourceRangeForSelection(selection, container) {
  if (!selection || selection.rangeCount === 0 || !container) return null;
  const tagged = (node) => {
    let current = node?.nodeType === 1 ? node : node?.parentElement;
    while (current && current !== container) {
      if (current.hasAttribute?.('data-so')) return current;
      current = current.parentElement;
    }
    return null;
  };
  const range = selection.getRangeAt(0);
  const startEl = tagged(range.startContainer);
  const endEl = tagged(range.endContainer);
  if (!startEl || !endEl) return null;
  const start = Math.min(Number(startEl.dataset.so), Number(endEl.dataset.so));
  const end = Math.max(Number(startEl.dataset.eo), Number(endEl.dataset.eo));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  // Occurrence of the selected text inside the start block, to pick the right one when it repeats.
  let occurrence = 0;
  try {
    const before = document.createRange();
    before.setStart(startEl, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const prefix = before.toString();
    const needle = selection.toString().trim();
    if (needle) {
      let index = -1;
      while ((index = prefix.indexOf(needle, index + 1)) !== -1) occurrence += 1;
    }
  } catch {
    occurrence = 0;
  }
  return { start, end, occurrence };
}
