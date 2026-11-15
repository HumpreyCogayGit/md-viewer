import { marked } from 'marked';
import { markdownList, markdownTable, operationFactory } from '../define.js';
import { parseFencedBlocks } from '../selection.js';
import * as md from './markdown.js';
import * as tables from './tables.js';

const op = operationFactory('Markdown');
const doc = operationFactory('Markdown', { inputScope: 'document' });
const report = operationFactory('Markdown', { outputMode: 'report' });
const table = operationFactory('Tables', {
  validate: tables.isMarkdownTable,
  invalidInputMessage: 'Select a Markdown table (header row + |---| delimiter row).',
});

export function markdownToHtml(markdown) {
  return marked.parse(String(markdown), { gfm: true, async: false });
}

let turndownPromise;
export async function htmlToMarkdown(html) {
  turndownPromise ||= import('turndown').then((module) => {
    const TurndownService = module.default || module;
    const service = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    });
    service.remove(['script', 'style', 'noscript', 'template']);
    service.addRule('strikethrough', { filter: ['del', 's', 'strike'], replacement: (content) => `~~${content}~~` });
    service.addRule('table', {
      filter: 'table',
      replacement: (_, node) => {
        const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
          Array.from(tr.children).map((cell) => cell.textContent.trim().replace(/\s+/g, ' ')),
        );
        if (rows.length === 0) return '';
        const [headers, ...body] = rows;
        return `\n\n${tables.renderMarkdownTable({ headers, align: [], rows: body })}\n\n`;
      },
    });
    service.addRule('taskListItems', {
      filter: (node) => node.nodeName === 'INPUT' && node.getAttribute('type') === 'checkbox',
      replacement: (_, node) => (node.checked || node.hasAttribute('checked') ? '[x] ' : '[ ] '),
    });
    return service;
  });
  const service = await turndownPromise;
  const output = service.turndown(String(html)).trim();
  // Turndown pads list markers ("-   item"); use a single space outside code blocks.
  const mask = md.codeLineMask(output);
  return output
    .split('\n')
    .map((line, index) => (mask[index] ? line : line.replace(/^(\s*)([-*+]|\d+\.)\s{2,}(?=\S)/, '$1$2 ')))
    .join('\n');
}

export async function validateKatex(markdown, { renderer } = {}) {
  const katex = renderer || (await import('katex')).default;
  const expressions = md.findMathExpressions(markdown);
  if (expressions.length === 0) return 'No math expressions found.';
  const problems = [];
  for (const { expression, display, line } of expressions) {
    try {
      katex.renderToString(expression, { displayMode: display, throwOnError: true, strict: 'ignore' });
    } catch (error) {
      problems.push([
        line,
        display ? 'block' : 'inline',
        `\`${expression.replace(/\|/g, '\\|').slice(0, 60)}\``,
        String(error.message).replace(/^KaTeX parse error: /, ''),
      ]);
    }
  }
  return problems.length
    ? `❌ ${problems.length} of ${expressions.length} expressions failed\n\n${markdownTable(['Line', 'Type', 'Expression', 'Error'], problems)}`
    : `✅ All ${expressions.length} math expressions render.`;
}

export async function validateMermaid(markdown, { parser } = {}) {
  const blocks = parseFencedBlocks(String(markdown)).filter((block) => block.language === 'mermaid');
  if (blocks.length === 0) return 'No mermaid code blocks found.';
  const parse = parser || (await import('mermaid')).default.parse;
  const problems = [];
  for (const [index, block] of blocks.entries()) {
    try {
      await parse(block.code);
    } catch (error) {
      const line = String(markdown).slice(0, block.start).split('\n').length;
      problems.push([index + 1, line, String(error.message || error).split('\n')[0]]);
    }
  }
  return problems.length
    ? `❌ ${problems.length} of ${blocks.length} diagrams have errors\n\n${markdownTable(['Diagram', 'Line', 'Error'], problems)}`
    : `✅ All ${blocks.length} Mermaid diagrams parse.`;
}

export function documentDiagnostics(markdown) {
  const headings = md.extractHeadings(markdown);
  const links = md.extractLinks(markdown);
  const blocks = parseFencedBlocks(String(markdown));
  const words = md.countWords(markdown);
  const languages = new Map();
  blocks.forEach((block) =>
    languages.set(block.language || '(none)', (languages.get(block.language || '(none)') || 0) + 1),
  );
  const tableCount = String(markdown)
    .split('\n')
    .filter((line, i, all) => line.includes('|') && all[i + 1] && tables.isTableDelimiterRow(all[i + 1])).length;
  const issues = [];
  headings.forEach((heading, index) => {
    const previous = headings[index - 1];
    if (previous && heading.level > previous.level + 1)
      issues.push(`Line ${heading.line + 1}: heading jumps from H${previous.level} to H${heading.level}`);
    if (!heading.text) issues.push(`Line ${heading.line + 1}: empty heading`);
  });
  if (headings.filter((heading) => heading.level === 1).length > 1) issues.push('More than one H1 heading');
  md.findBrokenAnchors(markdown).forEach((link) => issues.push(`Line ${link.line}: broken anchor ${link.url}`));
  links
    .filter((link) => link.style === 'reference' && link.missing)
    .forEach((link) => issues.push(`Line ${link.line}: missing reference definition [${link.label}]`));
  links
    .filter((link) => !link.url && link.style === 'inline')
    .forEach((link) => issues.push(`Line ${link.line}: empty link target`));
  links
    .filter((link) => link.type === 'image' && !link.text)
    .forEach((link) => issues.push(`Line ${link.line}: image without alt text`));
  links
    .filter((link) => /^\s*javascript:/i.test(link.url))
    .forEach((link) => issues.push(`Line ${link.line}: javascript: URL`));
  md.findDuplicateReferences(markdown).forEach((group) =>
    issues.push(
      `Duplicate reference definition [${group[0].label}] on lines ${group.map((d) => d.line + 1).join(', ')}`,
    ),
  );

  return [
    '### Document statistics',
    '',
    markdownTable(
      ['Metric', 'Value'],
      [
        ['Words', words],
        ['Reading time', `~${md.readingMinutes(words)} min`],
        ['Characters', String(markdown).length],
        ['Lines', String(markdown).split('\n').length],
        ['Headings', headings.length],
        ['Links', links.filter((link) => link.type === 'link').length],
        ['Images', links.filter((link) => link.type === 'image').length],
        [
          'Code blocks',
          blocks.length
            ? `${blocks.length} (${Array.from(languages, ([lang, count]) => `${lang} ×${count}`).join(', ')})`
            : 0,
        ],
        ['Tables', tableCount],
        ['Math expressions', md.findMathExpressions(markdown).length],
      ],
    ),
    '',
    '### Outline',
    '',
    headings.length
      ? headings.map((heading) => `${'  '.repeat(heading.level - 1)}- ${heading.text || '(empty)'}`).join('\n')
      : '_No headings._',
    '',
    '### Issues',
    '',
    issues.length ? markdownList(issues) : '✅ No issues found.',
  ].join('\n');
}

const TOC_OPTIONS = [
  { key: 'minLevel', label: 'From level', type: 'number', default: 2, min: 1, max: 6 },
  { key: 'maxLevel', label: 'To level', type: 'number', default: 4, min: 1, max: 6 },
  { key: 'ordered', label: 'Numbered', type: 'boolean', default: false },
];
const COLUMN_OPTION = { key: 'column', label: 'Column (number or header)', type: 'text', default: '1' };

export const markdownOperations = [
  doc({
    id: 'md.toc',
    name: 'Generate / Update Table of Contents',
    description: 'Insert a linked TOC between <!-- toc --> markers, or refresh an existing one.',
    aliases: ['toc', 'contents', 'outline'],
    options: TOC_OPTIONS,
    run: md.upsertToc,
  }),
  op({
    id: 'md.toc-snippet',
    name: 'Insert TOC at Cursor',
    description: 'Insert a TOC list (without markers) at the cursor.',
    aliases: ['toc'],
    inputScope: 'document',
    outputMode: 'insert',
    options: TOC_OPTIONS,
    run: (input, options) => md.buildToc(input, options) || '_No headings._',
  }),
  op({
    id: 'md.heading-up',
    name: 'Promote Headings (H3 → H2)',
    description: 'Decrease heading levels by one; refuses to go above H1.',
    aliases: ['shift headings', 'promote'],
    run: (input) => md.shiftHeadings(input, { by: -1 }),
  }),
  op({
    id: 'md.heading-down',
    name: 'Demote Headings (H2 → H3)',
    description: 'Increase heading levels by one; refuses to go below H6.',
    aliases: ['shift headings', 'demote'],
    run: (input) => md.shiftHeadings(input, { by: 1 }),
  }),
  op({
    id: 'md.slugify',
    name: 'Slugify',
    description: 'GitHub-style anchor slug for the selection.',
    aliases: ['slug', 'anchor', 'url-safe'],
    run: (input) =>
      input
        .split('\n')
        .map((line) => (line.trim() ? md.slugify(line) : line))
        .join('\n'),
  }),
  report({
    id: 'md.extract-links',
    name: 'Extract Links and Images',
    description: 'Table of every link and image with its target and line.',
    aliases: ['links', 'images', 'urls'],
    inputScope: 'document',
    run: (input) => {
      const links = md.extractLinks(input);
      return links.length
        ? markdownTable(
            ['Line', 'Type', 'Text', 'Target', 'Style'],
            links.map((link) => [
              link.line,
              link.type,
              link.text,
              link.missing ? '⚠️ missing definition' : link.url,
              link.style,
            ]),
          )
        : 'No links or images found.';
    },
  }),
  report({
    id: 'md.broken-anchors',
    name: 'Find Broken Heading Anchors',
    description: 'List #anchor links that do not match any heading.',
    aliases: ['dead links', 'anchors', 'link check'],
    inputScope: 'document',
    run: (input) => {
      const broken = md.findBrokenAnchors(input);
      return broken.length
        ? markdownTable(
            ['Line', 'Text', 'Anchor'],
            broken.map((link) => [link.line, link.text, link.url]),
          )
        : '✅ All local anchors resolve.';
    },
  }),
  report({
    id: 'md.duplicate-references',
    name: 'Find Duplicate Reference Definitions',
    description: 'Report reference-link labels that are defined more than once.',
    aliases: ['references', 'duplicates'],
    inputScope: 'document',
    run: (input) => {
      const groups = md.findDuplicateReferences(input);
      return groups.length
        ? markdownTable(
            ['Label', 'Lines', 'URLs'],
            groups.map((group) => [
              group[0].label,
              group.map((d) => d.line + 1).join(', '),
              group.map((d) => d.url).join(', '),
            ]),
          )
        : '✅ No duplicate reference definitions.';
    },
  }),
  op({
    id: 'md.inline-to-reference',
    name: 'Inline Links → Reference Links',
    description: 'Move link URLs to numbered definitions at the end.',
    aliases: ['reference links'],
    inverse: 'md.reference-to-inline',
    run: md.inlineToReferenceLinks,
  }),
  op({
    id: 'md.reference-to-inline',
    name: 'Reference Links → Inline Links',
    description: 'Inline reference-style links and remove their definitions.',
    aliases: ['inline links'],
    inverse: 'md.inline-to-reference',
    run: md.referenceToInlineLinks,
  }),
  op({
    id: 'md.sort-references',
    name: 'Sort Reference Definitions',
    description: 'Collect reference definitions at the end, sorted by label.',
    aliases: ['references'],
    run: md.sortReferenceDefinitions,
  }),
  op({
    id: 'md.renumber-footnotes',
    name: 'Renumber Footnotes',
    description: 'Number footnotes 1…n in order of first use and reorder definitions.',
    aliases: ['footnotes'],
    run: md.renumberFootnotes,
  }),
  report({
    id: 'md.front-matter-extract',
    name: 'Front Matter → JSON',
    description: 'Show the document’s YAML front matter as JSON.',
    aliases: ['frontmatter', 'metadata', 'yaml header'],
    inputScope: 'document',
    run: (input) => md.frontMatterToJson(input),
  }),
  op({
    id: 'md.data-to-front-matter',
    name: 'JSON/YAML → Front Matter',
    description: 'Turn a JSON or YAML selection into a --- front matter block.',
    aliases: ['frontmatter'],
    run: md.dataToFrontMatter,
  }),
  doc({
    id: 'md.set-front-matter',
    name: 'Replace Front Matter',
    description: 'Set the document’s front matter from JSON or YAML.',
    aliases: ['frontmatter', 'metadata'],
    options: [{ key: 'data', label: 'Front matter (JSON or YAML)', type: 'textarea', default: 'title: Untitled' }],
    run: (input, { data }) => md.setFrontMatter(input, data),
  }),
  op({
    id: 'md.normalize-fences',
    name: 'Normalize Code Fence Languages',
    description: 'Canonical language names (js → javascript, sh → bash, yml → yaml) and consistent fence characters.',
    aliases: ['code blocks', 'fences', 'language'],
    options: [
      {
        key: 'fenceChar',
        label: 'Fence',
        type: 'select',
        default: 'keep',
        choices: [
          { value: 'keep', label: 'Keep' },
          { value: '`', label: '``` backticks' },
          { value: '~', label: '~~~ tildes' },
        ],
      },
      { key: 'defaultLanguage', label: 'Language for unlabeled blocks', type: 'text', default: '' },
    ],
    run: md.normalizeFenceLanguages,
  }),
  op({
    id: 'md.wrap',
    name: 'Wrap Paragraphs',
    description: 'Hard-wrap paragraphs and list items; code, tables, headings and quotes are untouched.',
    aliases: ['reflow', 'hard wrap', 'fill'],
    options: [{ key: 'width', label: 'Width', type: 'number', default: 80, min: 20, max: 400 }],
    run: md.wrapMarkdown,
  }),
  op({
    id: 'md.to-plain-text',
    name: 'Markdown → Plain Text',
    description: 'Strip Markdown syntax.',
    aliases: ['strip markdown', 'text only'],
    potentiallyLossy: true,
    lossyWarning: 'All formatting, link targets and images are removed.',
    run: md.markdownToPlainText,
  }),
  op({
    id: 'md.to-html',
    name: 'Markdown → HTML',
    description: 'Render the selection to HTML source.',
    aliases: ['render', 'html'],
    outputType: 'html',
    inverse: 'md.from-html',
    run: markdownToHtml,
  }),
  op({
    id: 'md.from-html',
    name: 'HTML → Markdown',
    description: 'Convert HTML (e.g. copied from a web page) to Markdown.',
    aliases: ['turndown', 'html to md'],
    inputType: 'html',
    inverse: 'md.to-html',
    potentiallyLossy: true,
    lossyWarning: 'Styling, scripts and unsupported elements are dropped.',
    run: htmlToMarkdown,
  }),
  report({
    id: 'md.validate-katex',
    name: 'Validate Math (KaTeX)',
    description: 'Render every $…$ and $$…$$ expression and report errors.',
    aliases: ['latex', 'math', 'katex'],
    category: 'Validate',
    inputScope: 'document',
    run: (input) => validateKatex(input),
  }),
  report({
    id: 'md.validate-mermaid',
    name: 'Validate Mermaid Diagrams',
    description: 'Parse every ```mermaid block and report syntax errors.',
    aliases: ['mermaid', 'diagram'],
    category: 'Validate',
    inputScope: 'document',
    run: (input) => validateMermaid(input),
  }),
  report({
    id: 'md.diagnostics',
    name: 'Document Diagnostics',
    description: 'Word count, reading time, outline, links, images, code blocks and problems.',
    aliases: ['stats', 'lint', 'outline', 'reading time'],
    inputScope: 'document',
    run: documentDiagnostics,
  }),
  op({
    id: 'md.list-bullet',
    name: 'Convert to Bulleted List',
    description: 'Numbered/task/plain lines → bullets.',
    aliases: ['unordered list'],
    options: [{ key: 'marker', label: 'Marker', type: 'select', default: '-', choices: ['-', '*', '+'] }],
    run: (input, { marker }) => md.convertList(input, { to: 'bullet', marker }),
  }),
  op({
    id: 'md.list-numbered',
    name: 'Convert to Numbered List',
    description: 'Bullet/task/plain lines → numbered list.',
    aliases: ['ordered list'],
    run: (input) => md.convertList(input, { to: 'numbered' }),
  }),
  op({
    id: 'md.list-task',
    name: 'Convert to Task List',
    description: 'Lines → - [ ] tasks.',
    aliases: ['checklist', 'todo'],
    run: (input) => md.convertList(input, { to: 'task' }),
  }),
  op({
    id: 'md.renumber-lists',
    name: 'Renumber Ordered Lists',
    description: 'Fix numbering of ordered lists (nested lists handled).',
    aliases: ['renumber'],
    run: md.renumberOrderedLists,
  }),
  op({
    id: 'md.toggle-tasks',
    name: 'Toggle Task Checkboxes',
    description: 'Toggle, check or uncheck - [ ] items.',
    aliases: ['check', 'todo', 'done'],
    options: [
      { key: 'mode', label: 'Action', type: 'select', default: 'toggle', choices: ['toggle', 'check', 'uncheck'] },
    ],
    run: md.toggleTasks,
  }),
  op({
    id: 'md.escape',
    name: 'Escape Markdown',
    description: 'Backslash-escape characters that Markdown would interpret.',
    aliases: ['literal'],
    inverse: 'md.unescape',
    run: md.escapeMarkdown,
  }),
  op({
    id: 'md.unescape',
    name: 'Unescape Markdown',
    description: 'Remove Markdown backslash escapes.',
    aliases: [],
    inverse: 'md.escape',
    run: md.unescapeMarkdown,
  }),
  table({
    id: 'table.format',
    name: 'Format Markdown Table',
    description: 'Align table columns (wide characters handled).',
    aliases: ['align table', 'prettify table'],
    options: [{ key: 'pretty', label: 'Pad columns', type: 'boolean', default: true }],
    run: tables.formatMarkdownTable,
  }),
  doc({
    id: 'table.format-all',
    name: 'Format All Tables in Document',
    description: 'Align every Markdown table outside code blocks.',
    aliases: ['align tables'],
    category: 'Tables',
    run: (input) => tables.formatAllTables(input),
  }),
  table({
    id: 'table.sort',
    name: 'Sort Table by Column',
    description: 'Sort rows by a column (natural order).',
    aliases: ['order table'],
    options: [
      COLUMN_OPTION,
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
    ],
    run: tables.sortTable,
  }),
  table({
    id: 'table.transpose',
    name: 'Transpose Table',
    description: 'Swap rows and columns.',
    aliases: ['pivot', 'rotate'],
    run: tables.transposeTable,
  }),
  table({
    id: 'table.add-column',
    name: 'Add Table Column',
    description: 'Insert an empty column.',
    aliases: ['insert column'],
    options: [
      { key: 'name', label: 'Header', type: 'text', default: 'New' },
      { key: 'position', label: 'Position (0 = end)', type: 'number', default: 0, min: 0 },
    ],
    run: tables.addColumn,
  }),
  table({
    id: 'table.remove-column',
    name: 'Remove Table Column',
    description: 'Delete a column.',
    aliases: ['delete column'],
    options: [COLUMN_OPTION],
    run: tables.removeColumn,
  }),
  table({
    id: 'table.move-column',
    name: 'Move Table Column',
    description: 'Move a column to another position.',
    aliases: ['reorder column'],
    options: [COLUMN_OPTION, { key: 'to', label: 'New position', type: 'number', default: 1, min: 1 }],
    run: tables.moveColumn,
  }),
  table({
    id: 'table.align',
    name: 'Set Column Alignment',
    description: 'Left, center or right align one or all columns.',
    aliases: ['align'],
    options: [
      { key: 'column', label: 'Column (or "all")', type: 'text', default: 'all' },
      {
        key: 'align',
        label: 'Alignment',
        type: 'select',
        default: 'left',
        choices: ['left', 'center', 'right', 'none'],
      },
    ],
    run: tables.alignTable,
  }),
];
