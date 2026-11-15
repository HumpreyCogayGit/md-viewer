// Pure text transformations.
import { detectLineEnding, splitLines } from '../define.js';

// ---------------------------------------------------------------- Case
const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'in',
  'nor',
  'of',
  'on',
  'or',
  'the',
  'to',
  'up',
  'via',
  'vs',
]);

export function titleCase(text) {
  return String(text).replace(/\S+/g, (word, offset, whole) => {
    const lower = word.toLowerCase();
    const isFirst = whole.slice(0, offset).trim() === '' || /[.:!?]\s*$/.test(whole.slice(0, offset));
    if (!isFirst && SMALL_WORDS.has(lower)) return lower;
    return lower.replace(/^(\p{L})/u, (char) => char.toUpperCase());
  });
}

/** Split an identifier or phrase into words: handles camelCase, PascalCase, snake_case, kebab-case, acronyms. */
export function splitWords(text) {
  return String(text)
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

export const IDENTIFIER_CASES = {
  camel: (words) => words.map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word))).join(''),
  pascal: (words) => words.map(capitalize).join(''),
  snake: (words) => words.map((word) => word.toLowerCase()).join('_'),
  kebab: (words) => words.map((word) => word.toLowerCase()).join('-'),
  constant: (words) => words.map((word) => word.toUpperCase()).join('_'),
  dot: (words) => words.map((word) => word.toLowerCase()).join('.'),
};

/** Convert each line's identifiers to a case style, keeping line structure. */
export function convertIdentifierCase(text, style) {
  return splitLines(text)
    .map((line) => {
      const leading = line.match(/^\s*/)[0];
      const trailing = line.match(/\s*$/)[0];
      const words = splitWords(line);
      return words.length ? leading + IDENTIFIER_CASES[style](words) + trailing : line;
    })
    .join(detectLineEnding(text));
}

export const swapCase = (text) =>
  Array.from(String(text), (char) => (char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase())).join('');

export const sentenceCase = (text) =>
  String(text)
    .toLowerCase()
    .replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (match) => match.toUpperCase());

// ---------------------------------------------------------------- Whitespace
export const trimLines = (text, { mode = 'both' } = {}) =>
  splitLines(text)
    .map((line) => (mode === 'start' ? line.trimStart() : mode === 'end' ? line.trimEnd() : line.trim()))
    .join(detectLineEnding(text));

export const collapseWhitespace = (text) =>
  splitLines(text)
    .map((line) => {
      const leading = line.match(/^[ \t]*/)[0];
      return (
        leading +
        line
          .slice(leading.length)
          .replace(/[ \t ]+/g, ' ')
          .trimEnd()
      );
    })
    .join(detectLineEnding(text));

export const removeBlankLines = (text) =>
  splitLines(text)
    .filter((line) => line.trim())
    .join(detectLineEnding(text));

export const normalizeLineEndings = (text, { style = 'lf' } = {}) => {
  const lf = String(text).replace(/\r\n?/g, '\n');
  return style === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
};

export function tabsToSpaces(text, { width = 4 } = {}) {
  return splitLines(text)
    .map((line) => {
      let column = 0;
      let output = '';
      for (const char of line) {
        if (char === '\t') {
          const spaces = width - (column % width);
          output += ' '.repeat(spaces);
          column += spaces;
        } else {
          output += char;
          column += 1;
        }
      }
      return output;
    })
    .join(detectLineEnding(text));
}

export function spacesToTabs(text, { width = 4 } = {}) {
  return splitLines(text)
    .map((line) => {
      const leading = line.match(/^ */)[0].length;
      return '\t'.repeat(Math.floor(leading / width)) + ' '.repeat(leading % width) + line.slice(leading);
    })
    .join(detectLineEnding(text));
}

// ---------------------------------------------------------------- Lines
const lineOp = (fn) => (text, options) => fn(splitLines(text), options).join(detectLineEnding(text));

export const sortLines = lineOp((lines, { order = 'asc', caseSensitive = false, numeric = false } = {}) => {
  const collator = new Intl.Collator(undefined, { sensitivity: caseSensitive ? 'case' : 'base', numeric });
  const sorted = [...lines].sort(collator.compare);
  return order === 'desc' ? sorted.reverse() : sorted;
});

export const dedupeLines = lineOp((lines, { caseSensitive = true, trim = false } = {}) => {
  const seen = new Set();
  return lines.filter((line) => {
    let key = trim ? line.trim() : line;
    if (!caseSensitive) key = key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

export const reverseLines = lineOp((lines) => [...lines].reverse());

export const shuffleLines = lineOp((lines, { random = Math.random } = {}) => {
  const output = [...lines];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
});

export const prefixSuffixLines = lineOp((lines, { prefix = '', suffix = '', skipBlank = true } = {}) =>
  lines.map((line) => (skipBlank && !line.trim() ? line : `${prefix}${line}${suffix}`)),
);

export const addLineNumbers = lineOp((lines, { start = 1, separator = '. ', pad = true } = {}) => {
  const width = String(start + lines.length - 1).length;
  return lines.map(
    (line, index) => `${pad ? String(start + index).padStart(width, ' ') : start + index}${separator}${line}`,
  );
});

export const removeLineNumbers = lineOp((lines) => lines.map((line) => line.replace(/^\s*\d+(?:[.):]\s?|\s+|\t)/, '')));

export const headLines = lineOp((lines, { count = 10 } = {}) => lines.slice(0, count));
export const tailLines = lineOp((lines, { count = 10 } = {}) => (count === 0 ? [] : lines.slice(-count)));

export const filterLines = lineOp(
  (lines, { pattern = '', regex = false, invert = false, caseSensitive = false } = {}) => {
    let test;
    if (regex) {
      const compiled = new RegExp(pattern, caseSensitive ? '' : 'i');
      test = (line) => compiled.test(line);
    } else {
      const needle = caseSensitive ? pattern : pattern.toLowerCase();
      test = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
    }
    return lines.filter((line) => test(line) !== invert);
  },
);

export const padLines = lineOp((lines, { width = 20, side = 'end', char = ' ' } = {}) =>
  lines.map((line) => (side === 'start' ? line.padStart(width, char || ' ') : line.padEnd(width, char || ' '))),
);

/** Hard-wrap text at a width, preserving blank-line paragraph breaks and indentation of each paragraph. */
export function wrapText(text, { width = 80 } = {}) {
  const newline = detectLineEnding(text);
  return String(text)
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => {
      const indent = paragraph.match(/^[ \t]*/)[0];
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      const lines = [];
      let line = '';
      for (const word of words) {
        if (line && (indent + line + ' ' + word).length > width) {
          lines.push(indent + line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) lines.push(indent + line);
      return lines.join(newline);
    })
    .join(newline + newline);
}

/** Join hard-wrapped lines inside each paragraph. */
export function unwrapText(text) {
  const newline = detectLineEnding(text);
  return String(text)
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) =>
      paragraph
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' '),
    )
    .join(newline + newline);
}

export function countOccurrences(text, { by = 'line', caseSensitive = true } = {}) {
  const items =
    by === 'word' ? String(text).match(/[\p{L}\p{N}'’-]+/gu) || [] : splitLines(text).filter((line) => line.trim());
  const counts = new Map();
  for (const item of items) {
    const key = caseSensitive ? item : item.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const unescapeDelimiter = (value) => String(value).replace(/\\n/g, '\n').replace(/\\t/g, '\t');

export function splitText(text, { delimiter = ',', trim = true } = {}) {
  return String(text)
    .split(unescapeDelimiter(delimiter))
    .map((item) => (trim ? item.trim() : item))
    .filter((item, index, all) => item !== '' || all.length === 1)
    .join('\n');
}

export function joinLines(text, { delimiter = ', ', skipBlank = true } = {}) {
  return splitLines(text)
    .filter((line) => !skipBlank || line.trim())
    .join(unescapeDelimiter(delimiter));
}

// ---------------------------------------------------------------- Find / replace
export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findReplace(
  text,
  { find = '', replace = '', regex = false, flags = 'g', caseSensitive = true, wholeWord = false } = {},
) {
  if (find === '') throw new Error('Enter text to find.');
  let source = regex ? find : escapeRegExp(find);
  if (wholeWord) source = `\\b(?:${source})\\b`;
  let normalizedFlags = Array.from(new Set(flags.replace(/[^gimsuy]/g, ''))).join('');
  if (!caseSensitive && !normalizedFlags.includes('i')) normalizedFlags += 'i';
  if (!normalizedFlags.includes('g')) normalizedFlags += 'g';
  let pattern;
  try {
    pattern = new RegExp(source, normalizedFlags);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error.message}`, { cause: error });
  }
  // Literal mode must not interpret $& / $1 in the replacement.
  return String(text).replace(pattern, regex ? replace : () => replace);
}

// ---------------------------------------------------------------- Escaping for shells and SQL
export function escapeShell(text, { dialect = 'posix' } = {}) {
  const value = String(text);
  if (dialect === 'powershell') return `'${value.replace(/'/g, "''")}'`;
  if (dialect === 'cmd') return `"${value.replace(/(["^&|<>%!])/g, '^$1')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function escapeSqlString(text, { dialect = 'standard' } = {}) {
  const value = String(text);
  if (dialect === 'mysql') {
    return `'${value.replace(/[\0\n\r\b\t\x1a\\'"]/g, (char) => ({ '\0': '\\0', '\n': '\\n', '\r': '\\r', '\b': '\\b', '\t': '\\t', '\x1a': '\\Z', '\\': '\\\\', "'": "\\'", '"': '\\"' })[char])}'`;
  }
  if (dialect === 'postgres-e')
    return `E'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\t/g, '\\t')}'`;
  return `'${value.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------- Cleanup
const SMART_MAP = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '«': '"',
  '»': '"',
  '–': '-',
  '—': '--',
  '―': '--',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '…': '...',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '•': '*',
  '·': '*',
  '™': '(TM)',
  '©': '(c)',
  '®': '(R)',
};

export const smartToAscii = (text) =>
  String(text).replace(/[‘’‚‛′“-‟″«»–—―−‐‑…      •·™©®]/g, (char) => SMART_MAP[char]);

// Zero-width, bidi controls, soft hyphen, BOM and other invisible format characters.
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁦-⁯ㅤ︀-️﻿ﾠ\u{e0000}-\u{e007f}]/gu;

export function findInvisibleCharacters(text) {
  const found = [];
  let line = 1;
  let column = 1;
  for (const char of String(text)) {
    INVISIBLE.lastIndex = 0;
    if (INVISIBLE.test(char))
      found.push({ char, code: `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, line, column });
    if (char === '\n') {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return found;
}

export const removeInvisibleCharacters = (text) => String(text).replace(INVISIBLE, '');
export const revealInvisibleCharacters = (text) =>
  String(text).replace(INVISIBLE, (char) => `⟦U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`);

const ANSI =
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;
export const stripAnsi = (text) => String(text).replace(ANSI, '');

export const unicodeNormalize = (text, { form = 'NFC' } = {}) => String(text).normalize(form);
export const removeDiacritics = (text) =>
  String(text)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC');

/** Remove HTML tags (and script/style contents) without a DOM; decode entities separately. */
export function stripHtml(html, { decode = true, decoder } = {}) {
  let text = String(html)
    .replace(/<(script|style|template)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  if (decode && decoder) text = decoder(text);
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------- Sets and statistics
export function setOperation(left, right, { op = 'union', caseSensitive = true } = {}) {
  const key = (line) => (caseSensitive ? line : line.toLowerCase());
  const a = splitLines(left).filter((line) => line.trim());
  const b = splitLines(right).filter((line) => line.trim());
  const aKeys = new Set(a.map(key));
  const bKeys = new Set(b.map(key));
  const unique = (lines) => {
    const seen = new Set();
    return lines.filter((line) => !seen.has(key(line)) && seen.add(key(line)));
  };
  switch (op) {
    case 'intersection':
      return unique(a.filter((line) => bKeys.has(key(line))));
    case 'difference':
      return unique(a.filter((line) => !bKeys.has(key(line))));
    case 'symmetric':
      return unique([...a.filter((line) => !bKeys.has(key(line))), ...b.filter((line) => !aKeys.has(key(line)))]);
    default:
      return unique([...a, ...b]);
  }
}

export function numberStats(text) {
  const numbers = (String(text).match(/[-+]?(?:\d+(?:[.,]\d+)*(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/gi) || [])
    .map((token) => Number(token.replace(/,(?=\d{3}\b)/g, '')))
    .filter(Number.isFinite);
  if (numbers.length === 0) throw new Error('No numbers found in the selection.');
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((total, value) => total + value, 0);
  const mean = sum / numbers.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const variance = numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / numbers.length;
  const round = (value) => Number(value.toPrecision(12));
  return {
    count: numbers.length,
    sum: round(sum),
    mean: round(mean),
    median: round(median),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stddev: round(Math.sqrt(variance)),
  };
}

export function levenshtein(a, b) {
  const left = Array.from(String(a));
  const right = Array.from(String(b));
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function characterFrequency(text) {
  const chars = Array.from(String(text));
  const counts = new Map();
  for (const char of chars) counts.set(char, (counts.get(char) || 0) + 1);
  const entropy = chars.length
    ? -Array.from(counts.values()).reduce((total, count) => {
        const p = count / chars.length;
        return total + p * Math.log2(p);
      }, 0)
    : 0;
  return {
    total: chars.length,
    unique: counts.size,
    entropy,
    counts: Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
