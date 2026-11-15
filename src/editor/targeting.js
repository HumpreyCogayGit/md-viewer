// Decide what an operation runs on, and how its result is applied. Pure functions so the rules are testable.
import { findFencedBlockAt } from '../operations/selection.js';

/**
 * Resolve the input target for an operation.
 * Order: document-scoped operations → editor selection → preview selection → current fenced block →
 * generator at the caret → whole document (requires explicit confirmation).
 */
export function resolveTarget({
  operation,
  text,
  selectionStart,
  selectionEnd,
  previewRange,
  documentConfirmed = false,
}) {
  if (operation.inputScope === 'document') {
    return { kind: 'document', start: 0, end: text.length, insertAt: selectionEnd };
  }
  if (selectionEnd > selectionStart && text.slice(selectionStart, selectionEnd).trim()) {
    return { kind: 'selection', start: selectionStart, end: selectionEnd };
  }
  if (previewRange && previewRange.end > previewRange.start) {
    return { kind: 'preview', start: previewRange.start, end: previewRange.end };
  }
  if (operation.isGenerator) {
    return { kind: 'cursor', start: selectionStart, end: selectionStart };
  }
  const block = findFencedBlockAt(text, selectionStart);
  if (block && (operation.supportsFencedBlock || block.code.trim())) {
    if (operation.supportsFencedBlock)
      return { kind: 'block', start: block.start, end: block.end, language: block.language };
    // Operations without fence support run on the block's content only (between the fence lines).
    const contentStart = text.indexOf('\n', block.start) + 1;
    const contentEnd = Math.max(contentStart, block.end - block.closingFence.length - 1);
    return { kind: 'block-content', start: contentStart, end: contentEnd };
  }
  if (!text.trim()) return { kind: 'empty' };
  if (!documentConfirmed) return { kind: 'confirm-document' };
  return { kind: 'document', start: 0, end: text.length, insertAt: selectionEnd };
}

/**
 * Apply output to the document.
 * - replace: swap the target range for the output.
 * - insert: put the output after the target (on its own line) or at the caret.
 * Returns { text, start, end } where start/end select the inserted text.
 */
export function applyResult(text, target, output, mode = 'replace') {
  if (mode === 'insert') {
    if (target.kind === 'cursor') {
      const position = target.start;
      const before = text.slice(0, position);
      const after = text.slice(position);
      const multiline = output.includes('\n');
      const lead = multiline && before && !before.endsWith('\n') ? '\n' : '';
      const trail = multiline && after && !after.startsWith('\n') ? '\n' : '';
      const start = position + lead.length;
      return { text: before + lead + output + trail + after, start, end: start + output.length };
    }
    // Insert below the target as its own block, after the end of the target's last line.
    const anchor = target.kind === 'document' ? (target.insertAt ?? text.length) : target.end;
    // A selection that ends right after a newline ends on the previous line.
    const lineEnd = anchor > 0 && text[anchor - 1] === '\n' ? anchor - 1 : text.indexOf('\n', anchor);
    const position = lineEnd === -1 ? text.length : lineEnd;
    const before = text.slice(0, position);
    const after = text.slice(position);
    const lead = before === '' ? '' : '\n\n';
    // At the end of the document one trailing newline is enough; before more text keep a blank line.
    const atEnd = after.trim() === '';
    const trail = atEnd ? (after.startsWith('\n') ? '' : '\n') : after.startsWith('\n\n') ? '' : '\n';
    const start = position + lead.length;
    return { text: before + lead + output + trail + after, start, end: start + output.length };
  }
  const start = target.start ?? 0;
  const end = target.end ?? text.length;
  return { text: text.slice(0, start) + output + text.slice(end), start, end: start + output.length };
}

/** Human description of the target, for status messages and the preview dialog. */
export function describeTarget(target) {
  switch (target.kind) {
    case 'selection':
      return 'the selection';
    case 'preview':
      return 'the text selected in the preview';
    case 'block':
    case 'block-content':
      return 'the current code block';
    case 'cursor':
      return 'the cursor position';
    case 'document':
      return 'the whole document';
    default:
      return 'nothing';
  }
}
