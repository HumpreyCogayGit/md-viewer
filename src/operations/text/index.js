import { markdownList, markdownTable, operationFactory, splitTwoInputs } from '../define.js';
import { htmlDecode } from '../encoding/codecs.js';
import * as t from './transforms.js';

const text = operationFactory('Text');
const lines = operationFactory('Lines');
const cleanup = operationFactory('Cleanup');
const escaping = operationFactory('Escaping');
const analysis = operationFactory('Analysis', { outputMode: 'report' });

const caseOps = [
  ['upper', 'UPPER CASE', ['uppercase', 'caps'], (s) => s.toUpperCase()],
  ['lower', 'lower case', ['lowercase'], (s) => s.toLowerCase()],
  ['title', 'Title Case', ['headline case'], t.titleCase],
  ['sentence', 'Sentence case', [], t.sentenceCase],
  ['swap', 'sWAP cASE', ['invert case'], t.swapCase],
  ['camel', 'camelCase', ['camel'], (s) => t.convertIdentifierCase(s, 'camel')],
  ['pascal', 'PascalCase', ['upper camel'], (s) => t.convertIdentifierCase(s, 'pascal')],
  ['snake', 'snake_case', ['underscore'], (s) => t.convertIdentifierCase(s, 'snake')],
  ['kebab', 'kebab-case', ['dash case', 'slug'], (s) => t.convertIdentifierCase(s, 'kebab')],
  ['constant', 'CONSTANT_CASE', ['screaming snake'], (s) => t.convertIdentifierCase(s, 'constant')],
  ['dot', 'dot.case', [], (s) => t.convertIdentifierCase(s, 'dot')],
].map(([key, name, aliases, run]) =>
  text({ id: `case.${key}`, name, description: `Convert to ${name}.`, aliases: ['case', ...aliases], run }),
);

const WIDTH_OPTION = { key: 'width', label: 'Tab width', type: 'number', default: 4, min: 1, max: 16 };
const CASE_OPTION = { key: 'caseSensitive', label: 'Case sensitive', type: 'boolean', default: true };

export const textOperations = [
  ...caseOps,
  text({
    id: 'text.trim',
    name: 'Trim Lines',
    description: 'Remove leading and/or trailing whitespace on every line.',
    aliases: ['strip whitespace'],
    options: [
      {
        key: 'mode',
        label: 'Trim',
        type: 'select',
        default: 'both',
        choices: [
          { value: 'both', label: 'Both ends' },
          { value: 'start', label: 'Start' },
          { value: 'end', label: 'End (trailing)' },
        ],
      },
    ],
    run: t.trimLines,
  }),
  text({
    id: 'text.collapse-whitespace',
    name: 'Collapse Repeated Whitespace',
    description: 'Squeeze runs of spaces/tabs into one space (indentation is kept).',
    aliases: ['normalize spaces', 'squeeze'],
    run: t.collapseWhitespace,
  }),
  text({
    id: 'text.remove-blank-lines',
    name: 'Remove Blank Lines',
    description: 'Delete empty and whitespace-only lines.',
    aliases: ['empty lines'],
    run: t.removeBlankLines,
  }),
  text({
    id: 'text.line-endings',
    name: 'Normalize Line Endings',
    description: 'Convert all line endings to LF or CRLF.',
    aliases: ['crlf', 'lf', 'eol', 'dos2unix'],
    options: [
      {
        key: 'style',
        label: 'Line ending',
        type: 'select',
        default: 'lf',
        choices: [
          { value: 'lf', label: 'LF (Unix)' },
          { value: 'crlf', label: 'CRLF (Windows)' },
        ],
      },
    ],
    run: t.normalizeLineEndings,
  }),
  text({
    id: 'text.tabs-to-spaces',
    name: 'Tabs → Spaces',
    description: 'Expand tabs to tab stops.',
    aliases: ['expand tabs', 'untabify'],
    options: [WIDTH_OPTION],
    run: t.tabsToSpaces,
  }),
  text({
    id: 'text.spaces-to-tabs',
    name: 'Spaces → Tabs',
    description: 'Convert leading spaces to tabs.',
    aliases: ['unexpand', 'tabify'],
    options: [WIDTH_OPTION],
    run: t.spacesToTabs,
  }),
  text({
    id: 'text.wrap',
    name: 'Wrap Text',
    description: 'Hard-wrap paragraphs at a column width.',
    aliases: ['hard wrap', 'fold'],
    options: [{ key: 'width', label: 'Width', type: 'number', default: 80, min: 10, max: 400 }],
    run: t.wrapText,
  }),
  text({
    id: 'text.unwrap',
    name: 'Unwrap Text',
    description: 'Join hard-wrapped lines within each paragraph.',
    aliases: ['join lines', 'unfold'],
    run: t.unwrapText,
  }),
  text({
    id: 'text.find-replace',
    name: 'Find and Replace',
    description: 'Literal or regular-expression find/replace within the selection.',
    aliases: ['replace', 'regex replace', 'sed', 's///'],
    options: [
      { key: 'find', label: 'Find', type: 'text', default: '' },
      { key: 'replace', label: 'Replace with', type: 'text', default: '' },
      { key: 'regex', label: 'Regular expression', type: 'boolean', default: false },
      { key: 'flags', label: 'Regex flags', type: 'text', default: 'g' },
      { key: 'caseSensitive', label: 'Case sensitive', type: 'boolean', default: true },
      { key: 'wholeWord', label: 'Whole word', type: 'boolean', default: false },
    ],
    potentiallyLossy: true,
    lossyWarning: 'Check the preview: a broad pattern can replace more than intended.',
    run: t.findReplace,
  }),
  text({
    id: 'text.split',
    name: 'Split to Lines',
    description: 'Split a delimited list into one item per line.',
    aliases: ['explode', 'csv list to lines'],
    options: [
      { key: 'delimiter', label: 'Delimiter (\\n, \\t allowed)', type: 'text', default: ',' },
      { key: 'trim', label: 'Trim items', type: 'boolean', default: true },
    ],
    run: t.splitText,
  }),
  text({
    id: 'text.join',
    name: 'Join Lines',
    description: 'Join lines with a delimiter.',
    aliases: ['implode', 'lines to list'],
    options: [
      { key: 'delimiter', label: 'Delimiter (\\n, \\t allowed)', type: 'text', default: ', ' },
      { key: 'skipBlank', label: 'Skip blank lines', type: 'boolean', default: true },
    ],
    run: t.joinLines,
  }),

  lines({
    id: 'lines.sort',
    name: 'Sort Lines',
    description: 'Sort lines alphabetically or naturally.',
    aliases: ['order', 'sort'],
    options: [
      {
        key: 'order',
        label: 'Order',
        type: 'select',
        default: 'asc',
        choices: [
          { value: 'asc', label: 'Ascending' },
          { value: 'desc', label: 'Descending' },
        ],
      },
      { key: 'caseSensitive', label: 'Case sensitive', type: 'boolean', default: false },
      { key: 'numeric', label: 'Natural numbers (2 < 10)', type: 'boolean', default: true },
    ],
    run: t.sortLines,
  }),
  lines({
    id: 'lines.dedupe',
    name: 'Remove Duplicate Lines',
    description: 'Keep the first occurrence of each line.',
    aliases: ['unique', 'uniq', 'dedupe', 'distinct'],
    options: [CASE_OPTION, { key: 'trim', label: 'Ignore surrounding whitespace', type: 'boolean', default: false }],
    run: t.dedupeLines,
  }),
  lines({
    id: 'lines.reverse',
    name: 'Reverse Lines',
    description: 'Reverse line order.',
    aliases: ['tac', 'flip'],
    run: t.reverseLines,
  }),
  lines({
    id: 'lines.shuffle',
    name: 'Shuffle Lines',
    description: 'Randomly reorder lines.',
    aliases: ['random order'],
    run: (input) => t.shuffleLines(input),
  }),
  lines({
    id: 'lines.prefix-suffix',
    name: 'Add Prefix/Suffix to Lines',
    description: 'Add text before and/or after each line.',
    aliases: ['prepend', 'append', 'wrap lines'],
    options: [
      { key: 'prefix', label: 'Prefix', type: 'text', default: '- ' },
      { key: 'suffix', label: 'Suffix', type: 'text', default: '' },
      { key: 'skipBlank', label: 'Skip blank lines', type: 'boolean', default: true },
    ],
    run: t.prefixSuffixLines,
  }),
  lines({
    id: 'lines.number',
    name: 'Add Line Numbers',
    description: 'Prefix each line with its number.',
    aliases: ['nl', 'number lines'],
    inverse: 'lines.unnumber',
    options: [
      { key: 'start', label: 'Start at', type: 'number', default: 1 },
      { key: 'separator', label: 'Separator', type: 'text', default: '. ' },
      { key: 'pad', label: 'Align numbers', type: 'boolean', default: true },
    ],
    run: t.addLineNumbers,
  }),
  lines({
    id: 'lines.unnumber',
    name: 'Remove Line Numbers',
    description: 'Strip leading line numbers.',
    aliases: ['strip numbers'],
    inverse: 'lines.number',
    run: t.removeLineNumbers,
  }),
  lines({
    id: 'lines.head',
    name: 'First N Lines',
    description: 'Keep only the first N lines.',
    aliases: ['head', 'top'],
    options: [{ key: 'count', label: 'Lines', type: 'number', default: 10, min: 0 }],
    run: t.headLines,
  }),
  lines({
    id: 'lines.tail',
    name: 'Last N Lines',
    description: 'Keep only the last N lines.',
    aliases: ['tail', 'bottom'],
    options: [{ key: 'count', label: 'Lines', type: 'number', default: 10, min: 0 }],
    run: t.tailLines,
  }),
  lines({
    id: 'lines.filter',
    name: 'Filter Lines',
    description: 'Keep (or drop) lines that contain text or match a regex.',
    aliases: ['grep', 'keep lines', 'drop lines'],
    options: [
      { key: 'pattern', label: 'Text or pattern', type: 'text', default: '' },
      { key: 'regex', label: 'Regular expression', type: 'boolean', default: false },
      { key: 'invert', label: 'Drop matching lines', type: 'boolean', default: false },
      { key: 'caseSensitive', label: 'Case sensitive', type: 'boolean', default: false },
    ],
    run: t.filterLines,
  }),
  lines({
    id: 'lines.pad',
    name: 'Pad Lines',
    description: 'Pad each line to a fixed width.',
    aliases: ['align', 'pad'],
    options: [
      { key: 'width', label: 'Width', type: 'number', default: 20, min: 1, max: 1000 },
      {
        key: 'side',
        label: 'Side',
        type: 'select',
        default: 'end',
        choices: [
          { value: 'end', label: 'Right (pad end)' },
          { value: 'start', label: 'Left (pad start)' },
        ],
      },
      { key: 'char', label: 'Pad character', type: 'text', default: ' ' },
    ],
    run: t.padLines,
  }),
  lines({
    id: 'lines.set-operation',
    name: 'Set Operation on Two Lists',
    description: 'Union, intersection, difference or symmetric difference of two line lists separated by a --- line.',
    aliases: ['union', 'intersection', 'difference', 'compare lists'],
    options: [
      {
        key: 'op',
        label: 'Operation',
        type: 'select',
        default: 'union',
        choices: [
          { value: 'union', label: 'Union (A ∪ B)' },
          { value: 'intersection', label: 'Intersection (A ∩ B)' },
          { value: 'difference', label: 'Difference (A − B)' },
          { value: 'symmetric', label: 'Symmetric difference' },
        ],
      },
      CASE_OPTION,
    ],
    run: (input, options) => {
      const [a, b] = splitTwoInputs(input);
      return t.setOperation(a, b, options).join('\n');
    },
  }),

  cleanup({
    id: 'cleanup.smart-to-ascii',
    name: 'Smart Characters → ASCII',
    description: 'Straighten curly quotes, dashes, ellipses and non-breaking spaces (text pasted from Word/Docs).',
    aliases: ['curly quotes', 'smart quotes', 'em dash', 'nbsp'],
    run: t.smartToAscii,
  }),
  cleanup({
    id: 'cleanup.reveal-invisible',
    name: 'Reveal Invisible Characters',
    description: 'Mark zero-width, bidi and other invisible characters as ⟦U+XXXX⟧.',
    aliases: ['zero width', 'zwsp', 'hidden characters'],
    run: t.revealInvisibleCharacters,
  }),
  cleanup({
    id: 'cleanup.remove-invisible',
    name: 'Remove Invisible Characters',
    description: 'Delete zero-width, bidi-control, BOM and similar characters.',
    aliases: ['zero width', 'zwsp', 'bom'],
    run: t.removeInvisibleCharacters,
  }),
  cleanup({
    id: 'cleanup.strip-ansi',
    name: 'Strip ANSI Escape Codes',
    description: 'Remove terminal colour/control sequences from pasted output.',
    aliases: ['ansi', 'terminal colors', 'escape codes'],
    run: t.stripAnsi,
  }),
  cleanup({
    id: 'cleanup.unicode-normalize',
    name: 'Unicode Normalize',
    description: 'Apply NFC, NFD, NFKC or NFKD normalization.',
    aliases: ['nfc', 'nfd', 'nfkc', 'nfkd'],
    options: [{ key: 'form', label: 'Form', type: 'select', default: 'NFC', choices: ['NFC', 'NFD', 'NFKC', 'NFKD'] }],
    run: t.unicodeNormalize,
  }),
  cleanup({
    id: 'cleanup.remove-diacritics',
    name: 'Remove Diacritics',
    description: 'Strip accents (é → e).',
    aliases: ['accents', 'deaccent'],
    potentiallyLossy: true,
    lossyWarning: 'Accents are removed permanently.',
    run: t.removeDiacritics,
  }),
  cleanup({
    id: 'cleanup.strip-html',
    name: 'Strip HTML Tags',
    description: 'Convert HTML to plain text (scripts/styles removed, entities decoded).',
    aliases: ['html to text', 'remove tags'],
    run: (input) => t.stripHtml(input, { decoder: htmlDecode }),
  }),

  escaping({
    id: 'escape.json-string',
    name: 'JSON String Escape',
    description: 'Escape text for use inside a JSON string.',
    aliases: ['json escape', 'stringify'],
    inverse: 'unescape.json-string',
    run: (s) => JSON.stringify(s).slice(1, -1),
  }),
  escaping({
    id: 'unescape.json-string',
    name: 'JSON String Unescape',
    description: 'Decode a JSON string body (with or without quotes).',
    aliases: ['json unescape'],
    inverse: 'escape.json-string',
    run: (s) => {
      const trimmed = s.trim();
      const quoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1 ? trimmed : `"${s}"`;
      try {
        return JSON.parse(quoted);
      } catch {
        throw new Error('Invalid JSON string escape sequence.');
      }
    },
  }),
  escaping({
    id: 'escape.shell',
    name: 'Shell Quote',
    description: 'Quote text as a single shell argument (POSIX sh, PowerShell or cmd.exe).',
    aliases: ['bash', 'quote argument'],
    options: [
      {
        key: 'dialect',
        label: 'Shell',
        type: 'select',
        default: 'posix',
        choices: [
          { value: 'posix', label: 'POSIX sh / bash / zsh' },
          { value: 'powershell', label: 'PowerShell' },
          { value: 'cmd', label: 'Windows cmd.exe' },
        ],
      },
    ],
    notes: 'Quoting is for documentation; always review commands before running them.',
    run: t.escapeShell,
  }),
  escaping({
    id: 'escape.sql-string',
    name: 'SQL String Literal',
    description: 'Quote text as a SQL string literal for a dialect.',
    aliases: ['sql escape', 'quote sql'],
    options: [
      {
        key: 'dialect',
        label: 'Dialect',
        type: 'select',
        default: 'standard',
        choices: [
          { value: 'standard', label: "Standard SQL ('')" },
          { value: 'mysql', label: 'MySQL (backslash)' },
          { value: 'postgres-e', label: "PostgreSQL E''" },
        ],
      },
    ],
    notes: 'Use parameterized queries in real code; this is for examples and documentation.',
    run: t.escapeSqlString,
  }),

  analysis({
    id: 'analysis.count-occurrences',
    name: 'Count Occurrences',
    description: 'Count repeated lines or words as a Markdown table.',
    aliases: ['frequency', 'uniq -c', 'histogram'],
    options: [
      {
        key: 'by',
        label: 'Count',
        type: 'select',
        default: 'line',
        choices: [
          { value: 'line', label: 'Lines' },
          { value: 'word', label: 'Words' },
        ],
      },
      CASE_OPTION,
    ],
    run: (input, options) => markdownTable(['Item', 'Count'], t.countOccurrences(input, options)),
  }),
  analysis({
    id: 'analysis.find-invisible',
    name: 'List Invisible Characters',
    description: 'Report every invisible character with its line and column.',
    aliases: ['zero width', 'hidden'],
    run: (input) => {
      const found = t.findInvisibleCharacters(input);
      return found.length
        ? markdownTable(
            ['Code point', 'Line', 'Column'],
            found.map((item) => [item.code, item.line, item.column]),
          )
        : 'No invisible characters found.';
    },
  }),
  analysis({
    id: 'analysis.number-stats',
    name: 'Number Statistics',
    description: 'Count, sum, mean, median, min, max and standard deviation of the numbers in the selection.',
    aliases: ['sum', 'average', 'mean', 'median', 'stats'],
    run: (input) => markdownTable(['Statistic', 'Value'], Object.entries(t.numberStats(input))),
  }),
  analysis({
    id: 'analysis.levenshtein',
    name: 'Levenshtein Distance',
    description: 'Edit distance between two texts separated by a --- line.',
    aliases: ['edit distance', 'similarity'],
    run: (input) => {
      const [a, b] = splitTwoInputs(input);
      const distance = t.levenshtein(a, b);
      const longest = Math.max(Array.from(a).length, Array.from(b).length) || 1;
      return markdownTable(
        ['Measure', 'Value'],
        [
          ['Edit distance', distance],
          ['Similarity', `${((1 - distance / longest) * 100).toFixed(1)}%`],
        ],
      );
    },
  }),
  analysis({
    id: 'analysis.char-frequency',
    name: 'Character Frequency & Entropy',
    description: 'Character counts and Shannon entropy (bits per character).',
    aliases: ['entropy', 'frequency analysis'],
    run: (input) => {
      const { total, unique, entropy, counts } = t.characterFrequency(input);
      const visible = (char) => (char === ' ' ? '␠' : char === '\n' ? '␤' : char === '\t' ? '␉' : char);
      return [
        markdownList([`Characters: ${total}`, `Unique: ${unique}`, `Entropy: ${entropy.toFixed(4)} bits/char`]),
        '',
        markdownTable(
          ['Character', 'Count', '%'],
          counts.slice(0, 100).map(([char, count]) => [visible(char), count, ((count / total) * 100).toFixed(2)]),
        ),
      ].join('\n');
    },
  }),
];
