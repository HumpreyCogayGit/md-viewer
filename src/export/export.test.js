import { describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';
import { buildPdfDocument, findRemoteImages, inlineRuns, isRemoteUrl, PDF_FONTS, PDF_STYLES } from './pdf.js';
import { buildStandaloneHtml, escapeHtml } from './html.js';

const lex = (markdown) => marked.lexer(markdown, { gfm: true });
const texts = (node) => JSON.stringify(node);

describe('PDF document builder', () => {
  it('renders nested lists exactly once (regression)', async () => {
    const doc = await buildPdfDocument(lex('- parent\n  - child one\n  - child two\n- sibling'));
    const serialized = texts(doc.content);
    expect(serialized.match(/child one/g)).toHaveLength(1);
    expect(serialized.match(/child two/g)).toHaveLength(1);
    const list = doc.content[0];
    expect(list.ul[0].stack[0].text.map((run) => run.text).join('')).toBe('parent');
    expect(list.ul[0].stack[1].ul).toHaveLength(2);
  });

  it('keeps the text around an image in a paragraph (regression)', async () => {
    const loadImage = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AAAA', width: 100 }));
    const doc = await buildPdfDocument(lex('Before ![alt](img.png) after.'), { loadImage });
    expect(
      doc.content.map((node) =>
        node.image ? 'IMAGE' : typeof node.text === 'string' ? node.text : node.text.map((run) => run.text).join(''),
      ),
    ).toEqual(['Before ', 'IMAGE', 'alt', ' after.']);
    expect(loadImage).toHaveBeenCalledWith('img.png');
  });

  it('uses a monospace font for code (regression)', async () => {
    const doc = await buildPdfDocument(lex('```js\n  indented()\n```\n\nInline `x`.'));
    expect(PDF_STYLES.code.font).toBe('Courier');
    expect(PDF_STYLES.inlineCode.font).toBe('Courier');
    expect(PDF_FONTS.Courier.normal).toBe('Courier');
    const cell = doc.content[0].table.body[0][0];
    expect(cell).toMatchObject({ style: 'code', text: '  indented()', preserveLeadingSpaces: true });
    expect(texts(doc.content[1])).toContain('"style":"inlineCode"');
  });

  it('does not fetch remote images unless allowed', async () => {
    const loadImage = vi.fn();
    const tokens = lex('![remote](https://example.com/a.png)\n\n![local](data:image/png;base64,AA)');
    expect(findRemoteImages(tokens)).toEqual(['https://example.com/a.png']);
    const doc = await buildPdfDocument(tokens, {
      loadImage: async (href) => {
        loadImage(href);
        return { dataUrl: href, width: 10 };
      },
    });
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith('data:image/png;base64,AA');
    expect(texts(doc.content)).toContain('remote image not downloaded');
    expect(isRemoteUrl('//cdn.x/y.png')).toBe(true);
  });

  it('maps inline formatting, links, tables, quotes, math and mermaid', async () => {
    expect(inlineRuns(lex('**b** *i* ~~s~~ [l](https://x.com)')[0].tokens)).toEqual([
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'i', italics: true },
      { text: ' ' },
      { text: 's', decoration: 'lineThrough', color: '#888' },
      { text: ' ' },
      { text: 'l', link: 'https://x.com', color: '#1a5fb4', decoration: 'underline' },
    ]);
    const renderMath = vi.fn(async () => 'data:math');
    const renderMermaid = vi.fn(async () => {
      throw new Error('bad');
    });
    const doc = await buildPdfDocument(
      lex(
        '| a | b |\n|---|--:|\n| 1 | 2 |\n\n> quote **x**\n\n$$x^2$$\n\n```mermaid\ngraph TD\n```\n\n1. one\n2. two\n\n- [x] done',
      ),
      { renderMath, renderMermaid },
    );
    expect(doc.content[0].table.body[1][1].alignment).toBe('right');
    expect(texts(doc.content[1])).toContain('quote ');
    expect(doc.content[2].image).toBe('data:math');
    expect(texts(doc.content[3])).toContain('could not render');
    expect(doc.content[4].ol).toHaveLength(2);
    expect(texts(doc.content[5])).toContain('☑ ');
  });
});

describe('standalone HTML', () => {
  it('builds a self-contained document with escaped title and inlined CSS', () => {
    const html = buildStandaloneHtml('<h1>Hi</h1>', {
      title: 'A <b> & "c"',
      css: '.x{color:red}</style><script>',
      theme: 'dark',
    });
    expect(html).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(html).toContain('.x{color:red}<\\/style><script>');
    expect(html).not.toMatch(/<\/style><script>/);
    expect(html).toContain('class="md-viewer-container dark"');
    expect(html).toContain('<h1>Hi</h1>');
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });
});
