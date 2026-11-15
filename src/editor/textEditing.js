// Pure text-editing helpers used by the editor. Every function returns { text, start, end } (new selection).
import { countWords, readingMinutes } from '../operations/markdown/markdown.js';

const lineStartOf = (text, position) => text.lastIndexOf('\n', position - 1) + 1;

function touchedLines(text, start, end) {
  const from = lineStartOf(text, start);
  // A selection ending at column 0 of a line does not include that line.
  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
  let to = text.indexOf('\n', effectiveEnd);
  if (to === -1) to = text.length;
  return { from, to };
}

/** Tab: insert an indent at the caret, or indent every line touched by a multi-line selection. */
export function indentSelection(text, start, end, { unit = '  ' } = {}) {
  const selected = text.slice(start, end);
  if (!selected.includes('\n')) {
    const next = text.slice(0, start) + unit + text.slice(end);
    const caret = start + unit.length;
    return { text: next, start: caret, end: caret };
  }
  const { from, to } = touchedLines(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const indented = lines.map((line) => (line.length ? unit + line : line));
  const added = indented.reduce((sum, line, i) => sum + line.length - lines[i].length, 0);
  return {
    text: text.slice(0, from) + indented.join('\n') + text.slice(to),
    start: start + (lines[0].length ? unit.length : 0),
    end: end + added,
  };
}

/** Shift+Tab: remove one indent level from every touched line. */
export function outdentSelection(text, start, end, { unit = '  ' } = {}) {
  const { from, to } = touchedLines(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const width = unit === '\t' ? 1 : unit.length;
  const removedPerLine = lines.map((line) => {
    if (line.startsWith('\t')) return 1;
    let count = 0;
    while (count < width && line[count] === ' ') count += 1;
    return count;
  });
  const outdented = lines.map((line, i) => line.slice(removedPerLine[i]));
  const totalRemoved = removedPerLine.reduce((a, b) => a + b, 0);
  return {
    text: text.slice(0, from) + outdented.join('\n') + text.slice(to),
    start: Math.max(from, start - removedPerLine[0]),
    end: Math.max(from, end - totalRemoved),
  };
}

/** Bold/italic/code: wrap the selection, or unwrap it when it is already wrapped. */
export function toggleWrap(text, start, end, before, after = before, placeholder = '') {
  const selected = text.slice(start, end);
  const outerBefore = text.slice(start - before.length, start);
  const outerAfter = text.slice(end, end + after.length);
  if (selected && outerBefore === before && outerAfter === after) {
    return {
      text: text.slice(0, start - before.length) + selected + text.slice(end + after.length),
      start: start - before.length,
      end: end - before.length,
    };
  }
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  if (selected.includes('\n')) {
    const wrapped = selected
      .split('\n')
      .map((line) => (line.trim() ? before + line + after : line))
      .join('\n');
    return { text: text.slice(0, start) + wrapped + text.slice(end), start, end: start + wrapped.length };
  }
  const content = selected || placeholder;
  return {
    text: text.slice(0, start) + before + content + after + text.slice(end),
    start: start + before.length,
    end: start + before.length + content.length,
  };
}

/** Prefix each touched line (headings, quotes). */
export function prefixLines(text, start, end, prefix, placeholder = '') {
  if (start === end && lineStartOf(text, start) === start && (text[start] === '\n' || start === text.length)) {
    const inserted = prefix + placeholder;
    return {
      text: text.slice(0, start) + inserted + text.slice(end),
      start: start + prefix.length,
      end: start + inserted.length,
    };
  }
  const { from, to } = touchedLines(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const prefixed = lines
    .map((line) => (line.trim() ? prefix + line.replace(/^#{1,6}\s+/, prefix.startsWith('#') ? '' : '$&') : line))
    .join('\n');
  return { text: text.slice(0, from) + prefixed + text.slice(to), start: from, end: from + prefixed.length };
}

/** Insert a block on its own line(s) at the caret. */
export function insertBlock(text, position, block) {
  const before = text.slice(0, position);
  const needsLeadingBreak = before !== '' && !before.endsWith('\n');
  const inserted = `${needsLeadingBreak ? '\n' : ''}${block}\n`;
  const caret = position + inserted.length;
  return { text: before + inserted + text.slice(position), start: caret, end: caret };
}

export const SUPPORTED_FILE_PATTERN = /\.(md|markdown|mdown|mkd|mkdn|mdx|txt|text)$/i;
export const isSupportedFileName = (name) => SUPPORTED_FILE_PATTERN.test(String(name || ''));
export const FILE_ACCEPT = '.md,.markdown,.mdown,.mkd,.mkdn,.mdx,.txt,text/markdown,text/plain';

export function documentStats(text, selectionStart = 0, selectionEnd = 0) {
  const selected = text.slice(selectionStart, selectionEnd);
  const words = countWords(text);
  return {
    characters: text.length,
    words,
    lines: text === '' ? 1 : text.split('\n').length,
    readingMinutes: readingMinutes(words),
    selectionCharacters: selected.length,
    selectionWords: selected ? countWords(selected) : 0,
    cursorLine: text.slice(0, selectionStart).split('\n').length,
    cursorColumn: selectionStart - lineStartOf(text, selectionStart) + 1,
  };
}

/** Character offset at the start of a 1-based line. */
export function offsetOfLine(text, line) {
  let offset = 0;
  for (let i = 1; i < line; i += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}

// ------------------------------------------------------------------- Preview → source mapping
const stripInlineMarkdown = (line) =>
  line
    .replace(/^ {0,3}#{1,6}\s+/, '')
    .replace(/^ {0,3}>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*\*|___|\*\*|__|\*|_|~~|`)/g, '');

/**
 * Map text selected in the rendered preview back to a source range.
 * `range` (from data-source offsets on the rendered blocks) limits the search to the selected blocks, so the
 * selected occurrence — not the first occurrence in the document — is used. `occurrence` (0-based) disambiguates
 * repeated text inside the range.
 */
export function findInSource(markdown, selectedText, { range, occurrence = 0 } = {}) {
  const searchText = String(selectedText || '').trim();
  if (!searchText) return null;
  const from = range?.start ?? 0;
  const to = range?.end ?? markdown.length;
  const region = markdown.slice(from, to);

  // 1. Verbatim match inside the region.
  let index = -1;
  let found = 0;
  let cursor = 0;
  while ((cursor = region.indexOf(searchText, cursor)) !== -1) {
    if (found === occurrence) {
      index = cursor;
      break;
    }
    found += 1;
    cursor += 1;
  }
  if (index === -1 && found > 0 && occurrence >= found) index = region.lastIndexOf(searchText);
  if (index !== -1) return { start: from + index, end: from + index + searchText.length };

  // 2. Line-by-line match ignoring inline Markdown syntax.
  const searchLines = searchText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const sourceLines = region.split('\n');
  let offset = 0;
  let first = null;
  let lastEnd = null;
  let matched = 0;
  for (const line of sourceLines) {
    if (matched < searchLines.length && stripInlineMarkdown(line).includes(searchLines[matched])) {
      if (first === null) first = offset;
      lastEnd = offset + line.length;
      matched += 1;
    } else if (first !== null && matched < searchLines.length && line.trim() === '') {
      lastEnd = offset + line.length;
    }
    offset += line.length + 1;
    if (matched === searchLines.length) break;
  }
  if (first !== null && matched === searchLines.length) {
    // Single line: narrow to the words inside the line when possible.
    if (searchLines.length === 1) {
      const line = markdown.slice(from + first, from + lastEnd);
      const words = searchLines[0];
      const direct = line.indexOf(words);
      if (direct !== -1) return { start: from + first + direct, end: from + first + direct + words.length };
      // Expand to the smallest span that covers the first and last word (keeps surrounding markup balanced).
      const firstWord = words.split(/\s+/)[0];
      const lastWord = words.split(/\s+/).at(-1);
      const startInLine = line.indexOf(firstWord);
      const endInLine = line.lastIndexOf(lastWord);
      if (startInLine !== -1 && endInLine !== -1 && endInLine >= startInLine) {
        let s = startInLine;
        let e = endInLine + lastWord.length;
        while (s > 0 && /[*_~`[]/.test(line[s - 1])) s -= 1;
        while (e < line.length && /[*_~`\]]/.test(line[e])) e += 1;
        if (line[e] === '(') e = line.indexOf(')', e) + 1 || e;
        return { start: from + first + s, end: from + first + e };
      }
    }
    return { start: from + first, end: from + lastEnd };
  }
  return null;
}

// ------------------------------------------------------------------- Find
export function findMatches(text, query, { regex = false, caseSensitive = false, wholeWord = false } = {}) {
  if (!query) return { matches: [], error: null };
  let source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) source = `\\b(?:${source})\\b`;
  let pattern;
  try {
    pattern = new RegExp(source, caseSensitive ? 'gu' : 'giu');
  } catch (error) {
    return { matches: [], error: error.message };
  }
  const matches = [];
  for (const match of text.matchAll(pattern)) {
    if (match[0] === '') continue;
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= 10000) break;
  }
  return { matches, error: null, pattern };
}

export function replaceMatch(text, match, replacement, { regex = false, pattern } = {}) {
  const original = text.slice(match.start, match.end);
  const value =
    regex && pattern
      ? original.replace(new RegExp(pattern.source, pattern.flags.replace('g', '')), replacement)
      : replacement;
  return {
    text: text.slice(0, match.start) + value + text.slice(match.end),
    start: match.start,
    end: match.start + value.length,
  };
}

export function replaceAll(text, query, replacement, options = {}) {
  const { matches, error, pattern } = findMatches(text, query, options);
  if (error) throw new Error(error);
  if (matches.length === 0) return { text, count: 0 };
  let output = '';
  let cursor = 0;
  for (const match of matches) {
    const original = text.slice(match.start, match.end);
    output +=
      text.slice(cursor, match.start) +
      (options.regex
        ? original.replace(new RegExp(pattern.source, pattern.flags.replace('g', '')), replacement)
        : replacement);
    cursor = match.end;
  }
  return { text: output + text.slice(cursor), count: matches.length };
}
