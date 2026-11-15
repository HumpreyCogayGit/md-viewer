import { describe, expect, it } from 'vitest';
import { createOperationRegistry } from '../registry.js';
import { markdownOperations, validateMermaid } from './index.js';
import * as md from './markdown.js';
import * as tables from './tables.js';

const registry = createOperationRegistry(markdownOperations);
const run = (id, input, options) => registry.execute(id, input, options);

const DOC = `# Title

Intro with [a link](#section-one) and [broken](#nope).

## Section One

Text.

\`\`\`md
## Not a heading
\`\`\`

## Section One

### Sub-section: Ünïcode & More!

Setext Heading
--------------
`;

describe('headings, slugs and TOC', () => {
  it('slugifies like GitHub, including duplicates and Unicode', () => {
    expect(md.slugify('Sub-section: Ünïcode & More!')).toBe('sub-section-ünïcode--more');
    expect(md.slugify('Hello `code` *world*')).toBe('hello-code-world');
    expect(md.extractHeadings(DOC).map((h) => h.slug)).toEqual([
      'title',
      'section-one',
      'section-one-1',
      'sub-section-ünïcode--more',
      'setext-heading',
    ]);
  });

  it('ignores headings inside code fences', () => {
    expect(md.extractHeadings(DOC).some((h) => h.text === 'Not a heading')).toBe(false);
  });

  it('inserts a TOC after the H1 and updates it in place', async () => {
    const withToc = await run('md.toc', DOC);
    expect(withToc).toContain(
      '# Title\n\n<!-- toc -->\n\n- [Section One](#section-one)\n- [Section One](#section-one-1)\n  - [Sub-section: Ünïcode & More!](#sub-section-ünïcode--more)\n- [Setext Heading](#setext-heading)\n\n<!-- tocstop -->',
    );
    const updated = await run('md.toc', withToc.replace('## Section One\n\nText.', '## Renamed\n\nText.'));
    expect(updated).toContain('- [Renamed](#renamed)');
    expect(updated.match(/<!-- toc -->/g)).toHaveLength(1);
    expect(registry.get('md.toc').inputScope).toBe('document');
  });

  it('supports numbered TOCs and level ranges', () => {
    expect(md.buildToc(DOC, { minLevel: 2, maxLevel: 2, ordered: true })).toBe(
      '1. [Section One](#section-one)\n2. [Section One](#section-one-1)\n3. [Setext Heading](#setext-heading)',
    );
    expect(() => md.upsertToc('no headings')).toThrow(/No headings/);
  });

  it('shifts headings without producing invalid levels', async () => {
    expect(await run('md.heading-down', '# A\n### B')).toBe('## A\n#### B');
    expect(await run('md.heading-up', '## A\n### B')).toBe('# A\n## B');
    await expect(run('md.heading-up', '# Top')).rejects.toThrow(/between H1 and H6/);
    await expect(run('md.heading-down', '###### Deep')).rejects.toThrow(/between H1 and H6/);
    expect(await run('md.heading-down', 'Title\n=====')).toBe('Title\n-----');
    expect(await run('md.heading-down', 'Title\n-----')).toBe('### Title');
  });
});

describe('links and references', () => {
  const text =
    'See [one](https://a.com "A") and ![img](b.png) and [ref][r] and [missing][x] and <https://auto.dev>.\n`[not](link)`\n\n[r]: https://r.com\n[R]: https://dup.com';

  it('extracts links, images, reference and autolinks (not inside code)', () => {
    const links = md.extractLinks(text);
    expect(links.map((l) => [l.type, l.url, l.style])).toEqual([
      ['link', 'https://a.com', 'inline'],
      ['image', 'b.png', 'inline'],
      ['link', 'https://auto.dev', 'autolink'],
      ['link', 'https://r.com', 'reference'],
      ['link', '', 'reference'],
    ]);
    expect(links[4].missing).toBe(true);
  });

  it('finds duplicate definitions and broken anchors', async () => {
    expect(md.findDuplicateReferences(text)[0].map((d) => d.url)).toEqual(['https://r.com', 'https://dup.com']);
    expect(md.findBrokenAnchors(DOC).map((l) => l.url)).toEqual(['#nope']);
    expect(await run('md.broken-anchors', DOC)).toContain('| 3 | broken | #nope |');
    expect(md.findBrokenAnchors('<a id="custom"></a>\n[x](#custom)')).toEqual([]);
  });

  it('converts inline ↔ reference links', async () => {
    const input = 'A [x](https://x.com) and [y](https://x.com) and ![i](i.png "T") and [local](#a).';
    const refs = await run('md.inline-to-reference', input);
    expect(refs).toBe('A [x][1] and [y][1] and ![i][2] and [local](#a).\n\n[1]: https://x.com\n[2]: i.png "T"\n');
    expect(await run('md.reference-to-inline', refs)).toBe(`${input}\n`);
  });

  it('sorts reference definitions to the end', async () => {
    expect(await run('md.sort-references', '[b]: /b\ntext\n[a]: /a')).toBe('text\n\n[a]: /a\n[b]: /b\n');
  });

  it('renumbers footnotes by first use', async () => {
    expect(await run('md.renumber-footnotes', 'B[^b] A[^a] B[^b]\n\n[^a]: Alpha\n[^b]: Beta\n    more')).toBe(
      'B[^1] A[^2] B[^1]\n\n[^1]: Beta\n    more\n[^2]: Alpha\n',
    );
  });
});

describe('front matter', () => {
  it('extracts front matter as JSON', async () => {
    expect(JSON.parse(await run('md.front-matter-extract', '---\ntitle: Hi\ntags: [a, b]\n---\nBody'))).toEqual({
      title: 'Hi',
      tags: ['a', 'b'],
    });
    await expect(run('md.front-matter-extract', 'No front matter')).rejects.toThrow(/No front matter/);
  });

  it('creates and replaces front matter from JSON or YAML', async () => {
    expect(await run('md.data-to-front-matter', '{"title":"Hi","draft":true}')).toBe(
      '---\ntitle: Hi\ndraft: true\n---\n',
    );
    expect(await run('md.set-front-matter', '---\nold: 1\n---\n# Body', { data: 'title: New' })).toBe(
      '---\ntitle: New\n---\n# Body',
    );
    expect(await run('md.set-front-matter', '# Body', { data: '{"a":1}' })).toBe('---\na: 1\n---\n\n# Body');
    await expect(run('md.data-to-front-matter', '[1,2]')).rejects.toThrow(/object/);
  });
});

describe('fences, wrapping and plain text', () => {
  it('normalizes fence languages and characters', async () => {
    expect(
      await run('md.normalize-fences', '```JS\nx\n```\n~~~sh title="run"\nls\n~~~\n```\ny\n```', {
        fenceChar: '`',
        defaultLanguage: 'text',
      }),
    ).toBe('```javascript\nx\n```\n```bash title="run"\nls\n```\n```text\ny\n```');
  });

  it('wraps paragraphs and list items but leaves code, tables and headings alone', async () => {
    const input =
      '# A very long heading that must not be wrapped at all\n\nalpha beta gamma delta epsilon\n\n- item one two three four\n\n```\ncode code code code code code\n```\n\n| a | b |\n|---|---|';
    expect(await run('md.wrap', input, { width: 20 })).toBe(
      '# A very long heading that must not be wrapped at all\n\nalpha beta gamma\ndelta epsilon\n\n- item one two three\n  four\n\n```\ncode code code code code code\n```\n\n| a | b |\n|---|---|',
    );
  });

  it('converts Markdown to plain text', async () => {
    expect(
      await run(
        'md.to-plain-text',
        '---\na: 1\n---\n# Title\n\n**Bold** and [link](u) and `code`.\n\n- [x] done\n\n```js\nlet a;\n```',
      ),
    ).toBe('Title\n\nBold and link and code.\n\ndone\n\nlet a;');
  });

  it('counts words outside code and estimates reading time', () => {
    expect(md.countWords('# Hi there\n\n```\nignored words here\n```\nOne two.')).toBe(4);
    expect(md.readingMinutes(460)).toBe(2);
  });
});

describe('HTML conversion', () => {
  it('renders Markdown to HTML', async () => {
    expect(await run('md.to-html', '# Hi\n\n~~x~~')).toBe('<h1>Hi</h1>\n<p><del>x</del></p>\n');
  });

  it('converts HTML to Markdown including tables and strikethrough', async () => {
    const html =
      '<h2>T</h2><p>A <strong>b</strong> <a href="https://x.com">c</a> <del>d</del></p><ul><li>one</li></ul><table><tr><th>H</th></tr><tr><td>v</td></tr></table><script>alert(1)</script>';
    const output = await run('md.from-html', html);
    expect(output).toContain('## T');
    expect(output).toContain('A **b** [c](https://x.com) ~~d~~');
    expect(output).toContain('- one');
    expect(output).toContain('| H   |\n| --- |\n| v   |');
    expect(output).not.toContain('alert');
  });
});

describe('validation and diagnostics', () => {
  it('validates KaTeX expressions with line numbers', async () => {
    expect(await run('md.validate-katex', 'Inline $x^2$ ok.\n\n$$\\frac{1}{2}$$')).toBe(
      '✅ All 2 math expressions render.',
    );
    const report = await run('md.validate-katex', 'Bad $\\frac{1}$ here\n\n`$not math$`');
    expect(report).toContain('❌ 1 of 1 expressions failed');
    expect(report).toContain('| 1 | inline |');
    expect(await run('md.validate-katex', 'Costs $5 and $10')).toBe('No math expressions found.');
  });

  it('validates Mermaid blocks with an injectable parser', async () => {
    const parser = async (code) => {
      if (code.includes('BROKEN')) throw new Error('Parse error on line 2');
    };
    expect(await validateMermaid('```mermaid\ngraph TD\nA-->B\n```', { parser })).toBe(
      '✅ All 1 Mermaid diagrams parse.',
    );
    expect(await validateMermaid('text\n```mermaid\nBROKEN\n```', { parser })).toContain(
      '| 1 | 2 | Parse error on line 2 |',
    );
    expect(await validateMermaid('none', { parser })).toBe('No mermaid code blocks found.');
  });

  it('reports document diagnostics', async () => {
    const report = await run('md.diagnostics', `${DOC}\n#### Jump\n\n![](x.png) [bad][nope]\n`);
    expect(report).toContain('| Headings | 6 |');
    expect(report).toContain('| Code blocks | 1 (md ×1) |');
    expect(report).toContain('broken anchor #nope');
    expect(report).toContain('image without alt text');
    expect(report).toContain('missing reference definition [nope]');
    expect(report).toContain('heading jumps from H2 to H4');
  });
});

describe('lists', () => {
  it('converts between list types', async () => {
    expect(await run('md.list-numbered', '- a\n- b\n  - c\n  - d')).toBe('1. a\n2. b\n  1. c\n  2. d');
    expect(await run('md.list-bullet', '1. a\n2. [x] b', { marker: '*' })).toBe('* a\n* b');
    expect(await run('md.list-task', '- a\n- [x] b\nplain')).toBe('- [ ] a\n- [x] b\n- [ ] plain');
  });

  it('renumbers ordered lists and toggles tasks', async () => {
    expect(await run('md.renumber-lists', '1. a\n1. b\n   3. x\n   9. y\n1. c\n\nPara\n\n5. new\n5. list')).toBe(
      '1. a\n2. b\n   3. x\n   4. y\n3. c\n\nPara\n\n5. new\n6. list',
    );
    expect(await run('md.toggle-tasks', '- [ ] a\n- [x] b')).toBe('- [x] a\n- [ ] b');
    expect(await run('md.toggle-tasks', '- [ ] a\n- [x] b', { mode: 'check' })).toBe('- [x] a\n- [x] b');
  });

  it('escapes and unescapes Markdown', async () => {
    const raw = '*not bold* [x](y) 1. # _';
    const escaped = await run('md.escape', raw);
    expect(escaped).toBe('\\*not bold\\* \\[x\\]\\(y\\) 1. \\# \\_');
    expect(await run('md.unescape', escaped)).toBe(raw);
  });
});

describe('tables', () => {
  const table = '| Name | Qty | Note |\n|:--|--:|:-:|\n| apple | 10 | a\\|b |\n| Kiwi | 2 | `x|y` |\n| 漢字 | 1 |';

  it('parses pipes in code and escapes, and pads missing cells', () => {
    const parsed = tables.parseMarkdownTable(table);
    expect(parsed.align).toEqual(['left', 'right', 'center']);
    expect(parsed.rows[1]).toEqual(['Kiwi', '2', '`x|y`']);
    expect(parsed.rows[2]).toEqual(['漢字', '1', '']);
  });

  it('formats with alignment and wide-character widths', async () => {
    expect(await run('table.format', table)).toBe(
      // GFM requires pipes inside code spans in tables to be escaped, so `x|y` is repaired to `x\|y`.
      '| Name  | Qty |  Note  |\n| :---- | --: | :----: |\n| apple |  10 |  a\\|b  |\n| Kiwi  |   2 | `x\\|y` |\n| 漢字  |   1 |        |',
    );
  });

  it('sorts, transposes, adds, removes, moves and aligns columns', async () => {
    const simple = '| a | b |\n|---|---|\n| 2 | x |\n| 10 | y |';
    expect(await run('table.sort', simple, { column: 'a', order: 'desc' })).toContain('| 10  | y   |\n| 2   | x   |');
    expect(await run('table.transpose', simple)).toBe('| a   | 2   | 10  |\n| --- | --- | --- |\n| b   | x   | y   |');
    expect(await run('table.add-column', simple, { name: 'c', position: 1 })).toContain('| c   | a   | b   |');
    expect(await run('table.remove-column', simple, { column: '2' })).toBe('| a   |\n| --- |\n| 2   |\n| 10  |');
    expect(await run('table.move-column', simple, { column: 'b', to: 1 })).toContain('| b   | a   |');
    expect(await run('table.align', simple, { align: 'right' })).toContain('| --: | --: |');
    await expect(run('table.sort', simple, { column: 'zzz' })).rejects.toThrow(/not found/);
    await expect(run('table.format', 'no table')).rejects.toThrow(/Markdown table/);
  });

  it('formats every table in a document but not inside code', async () => {
    const docWithTables = '|a|b|\n|-|-|\n|1|2|\n\n```\n|x|y|\n|-|-|\n```';
    expect(await run('table.format-all', docWithTables)).toBe(
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n```\n|x|y|\n|-|-|\n```',
    );
  });
});
