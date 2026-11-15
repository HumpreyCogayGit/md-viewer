// PDF export. `buildPdfDocument` is pure apart from the injected helpers, so the token → pdfmake mapping is unit
// tested. `exportPdf` lazy-loads pdfmake (and KaTeX/Mermaid/html2canvas only when the document needs them).

export const PDF_FONTS = {
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
  // Standard PDF font: monospace without bundling another TTF.
  Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' },
};

export const PDF_STYLES = {
  h1: { fontSize: 26, bold: true, color: '#111' },
  h2: { fontSize: 22, bold: true, color: '#222' },
  h3: { fontSize: 18, bold: true, color: '#333' },
  h4: { fontSize: 15, bold: true },
  h5: { fontSize: 13, bold: true },
  h6: { fontSize: 11, bold: true },
  body: { fontSize: 11, lineHeight: 1.5, color: '#222' },
  code: { font: 'Courier', fontSize: 9, color: '#333', lineHeight: 1.2 },
  inlineCode: { font: 'Courier', fontSize: 10, background: '#f0f0f0' },
  blockquote: { fontSize: 11, italics: true, color: '#555' },
  tableHeader: { fontSize: 10, bold: true, color: '#111' },
  tableCell: { fontSize: 10, color: '#333', lineHeight: 1.4 },
  caption: { fontSize: 9, italics: true, color: '#666' },
};

export const isRemoteUrl = (href) => /^(https?:)?\/\//i.test(String(href || ''));

/** Remote image URLs referenced by the document (used to ask before fetching). */
export function findRemoteImages(tokens) {
  const urls = new Set();
  const walk = (list) => {
    for (const token of list || []) {
      if (token.type === 'image' && isRemoteUrl(token.href)) urls.add(token.href);
      walk(token.tokens);
      if (token.items) token.items.forEach((item) => walk(item.tokens));
      if (token.rows) token.rows.flat().forEach((cell) => walk(cell.tokens));
      if (token.header) token.header.forEach((cell) => walk(cell.tokens));
    }
  };
  walk(tokens);
  return Array.from(urls);
}

/** Inline Markdown tokens → pdfmake text runs. */
export function inlineRuns(tokens, inherited = {}) {
  const runs = [];
  for (const token of tokens || []) {
    switch (token.type) {
      case 'strong':
        runs.push(...inlineRuns(token.tokens, { ...inherited, bold: true }));
        break;
      case 'em':
        runs.push(...inlineRuns(token.tokens, { ...inherited, italics: true }));
        break;
      case 'del':
        runs.push(...inlineRuns(token.tokens, { ...inherited, decoration: 'lineThrough', color: '#888' }));
        break;
      case 'codespan':
        runs.push({ text: decodeEntities(token.text), ...inherited, style: 'inlineCode' });
        break;
      case 'link':
        runs.push(
          ...inlineRuns(token.tokens, { ...inherited, link: token.href, color: '#1a5fb4', decoration: 'underline' }),
        );
        break;
      case 'br':
        runs.push({ text: '\n', ...inherited });
        break;
      case 'image':
        runs.push({ text: `[${token.text || 'image'}]`, ...inherited, italics: true, color: '#666' });
        break;
      case 'inlineMath':
        runs.push({ text: token.text, ...inherited, italics: true, color: '#6a0dad' });
        break;
      case 'text':
      case 'escape':
        if (token.tokens?.length) runs.push(...inlineRuns(token.tokens, inherited));
        else runs.push({ text: decodeEntities(token.text), ...inherited });
        break;
      case 'html':
        runs.push({ text: decodeEntities(String(token.text).replace(/<[^>]*>/g, '')), ...inherited });
        break;
      default:
        if (token.text) runs.push({ text: decodeEntities(token.text), ...inherited });
    }
  }
  return runs.filter((run) => run.text !== '');
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

async function imageNode(token, helpers, margin) {
  const local = !isRemoteUrl(token.href);
  if (!local && !helpers.allowRemoteImages) {
    return [{ text: `[Image: ${token.text || token.href} — remote image not downloaded]`, style: 'caption', margin }];
  }
  try {
    const { dataUrl, width } = await helpers.loadImage(token.href);
    const nodes = [{ image: dataUrl, width: Math.min(width || 400, 400), alignment: 'center', margin }];
    if (token.text) nodes.push({ text: token.text, style: 'caption', alignment: 'center', margin: [0, 0, 0, 8] });
    return nodes;
  } catch {
    return [{ text: `[Image: ${token.text || token.href}]`, style: 'caption', margin }];
  }
}

/** A paragraph may mix text and images: emit text, image, text in order so nothing is dropped (regression). */
async function paragraphNodes(token, helpers) {
  const nodes = [];
  let pending = [];
  const flush = () => {
    const runs = inlineRuns(pending);
    if (runs.some((run) => String(run.text).trim())) nodes.push({ text: runs, style: 'body', margin: [0, 0, 0, 8] });
    pending = [];
  };
  for (const child of token.tokens || []) {
    if (child.type === 'image') {
      flush();
      nodes.push(...(await imageNode(child, helpers, [0, 4, 0, 8])));
    } else {
      pending.push(child);
    }
  }
  flush();
  return nodes;
}

/** List item content without its nested list (the nested list is rendered once, below). Regression fix. */
function listItemRuns(item) {
  const own = (item.tokens || []).filter((token) => token.type !== 'list');
  const runs = [];
  own.forEach((token, index) => {
    if (index > 0) runs.push({ text: '\n' });
    runs.push(...inlineRuns(token.tokens?.length ? token.tokens : [token]));
  });
  if (item.task) runs.unshift({ text: item.checked ? '☑ ' : '☐ ' });
  return runs;
}

function buildList(listToken) {
  const items = listToken.items.map((item) => {
    const content = { text: listItemRuns(item), style: 'body' };
    const nested = (item.tokens || []).filter((token) => token.type === 'list').map(buildList);
    return nested.length ? { stack: [content, ...nested] } : content;
  });
  return {
    [listToken.ordered ? 'ol' : 'ul']: items,
    ...(listToken.ordered && listToken.start > 1 ? { start: listToken.start } : {}),
    margin: [0, 0, 0, 8],
  };
}

const BLOCK_MATH = /^\$\$([\s\S]+?)\$\$$/;

/** Marked tokens → pdfmake document definition. */
export async function buildPdfDocument(tokens, helpers = {}) {
  const content = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        content.push({
          text: inlineRuns(token.tokens),
          style: `h${token.depth}`,
          margin: [0, token.depth === 1 ? 14 : 10, 0, 4],
        });
        break;
      case 'paragraph': {
        const math = BLOCK_MATH.exec(token.raw.trim());
        if (math && helpers.renderMath) {
          try {
            content.push({
              image: await helpers.renderMath(math[1].trim()),
              width: 200,
              alignment: 'center',
              margin: [0, 6, 0, 6],
            });
          } catch {
            content.push({ text: token.raw.trim(), style: 'code', margin: [0, 4, 0, 8] });
          }
          break;
        }
        content.push(...(await paragraphNodes(token, helpers)));
        break;
      }
      case 'list':
        content.push(buildList(token));
        break;
      case 'code':
        if (token.lang === 'mermaid' && helpers.renderMermaid) {
          try {
            content.push({
              image: await helpers.renderMermaid(token.text),
              width: 260,
              alignment: 'center',
              margin: [0, 6, 0, 8],
            });
          } catch {
            content.push({ text: '[Mermaid diagram — could not render]', style: 'caption', margin: [0, 4, 0, 8] });
          }
        } else {
          content.push({
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    text: token.text,
                    style: 'code',
                    preserveLeadingSpaces: true,
                    border: [false, false, false, false],
                  },
                ],
              ],
            },
            fillColor: '#f5f5f5',
            layout: { paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
            margin: [0, 0, 0, 10],
          });
        }
        break;
      case 'blockquote': {
        const inner = await buildPdfDocument(token.tokens || [], helpers);
        content.push({
          table: {
            widths: [2, '*'],
            body: [
              [
                { text: ' ', fillColor: '#aaaaaa' },
                { stack: inner.content, style: 'blockquote', margin: [8, 4, 0, 4] },
              ],
            ],
          },
          layout: 'noBorders',
          margin: [0, 4, 0, 8],
        });
        break;
      }
      case 'hr':
        content.push({
          canvas: [{ type: 'line', x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 1, lineColor: '#cccccc' }],
          margin: [0, 8, 0, 8],
        });
        break;
      case 'table': {
        const header = token.header.map((cell) => ({
          text: inlineRuns(cell.tokens),
          style: 'tableHeader',
          fillColor: '#f0f0f0',
          alignment: cell.align || 'left',
        }));
        const rows = token.rows.map((row) =>
          row.map((cell) => ({ text: inlineRuns(cell.tokens), style: 'tableCell', alignment: cell.align || 'left' })),
        );
        content.push({
          table: { headerRows: 1, widths: Array(header.length).fill('*'), body: [header, ...rows] },
          layout: {
            hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 1.5 : 0.5),
            vLineWidth: () => 0.5,
            hLineColor: () => '#cccccc',
            vLineColor: () => '#cccccc',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
          margin: [0, 6, 0, 12],
        });
        break;
      }
      case 'html': {
        const text = decodeEntities(String(token.text).replace(/<[^>]*>/g, '')).trim();
        if (text) content.push({ text, style: 'body', margin: [0, 0, 0, 8] });
        break;
      }
      case 'space':
      case 'def':
        break;
      default:
        if (token.text) content.push({ text: token.text, style: 'body', margin: [0, 0, 0, 8] });
    }
  }
  return { content, defaultStyle: { font: 'Roboto' }, styles: PDF_STYLES, pageMargins: [50, 50, 50, 50] };
}

// ------------------------------------------------------------------- Browser helpers (lazy)
function loadImageAsDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

function svgToPngDataUrl(svgString, targetWidth = 520, scale = 2) {
  return new Promise((resolve, reject) => {
    const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) {
      reject(new Error('Invalid SVG'));
      return;
    }
    let width = parseFloat(svg.getAttribute('width')) || 400;
    let height = parseFloat(svg.getAttribute('height')) || 300;
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(Number);
      if (parts.length === 4) [, , width, height] = parts;
    }
    const drawHeight = targetWidth * (height / width);
    svg.setAttribute('width', String(targetWidth));
    svg.setAttribute('height', String(drawHeight));
    if (!viewBox) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const serialized = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth * scale;
      canvas.height = drawHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  });
}

async function renderMathToDataUrl(expression) {
  const [{ default: katex }, { default: html2canvas }] = await Promise.all([import('katex'), import('html2canvas')]);
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;background:#fff;padding:16px;';
  container.innerHTML = katex.renderToString(expression, { displayMode: true, throwOnError: false, output: 'html' });
  document.body.appendChild(container);
  try {
    return (await html2canvas(container, { backgroundColor: '#ffffff', scale: 2 })).toDataURL('image/png');
  } finally {
    container.remove();
  }
}

async function renderMermaidToDataUrl(code) {
  const { renderMermaidSvg } = await import('../preview/mermaid.js');
  const svg = await renderMermaidSvg(code, 'default');
  return svgToPngDataUrl(svg);
}

/**
 * Build and download a PDF. `confirmRemote(urls)` is awaited when the document references remote images; return
 * true to allow fetching them. Throws on failure so the caller can report it.
 */
export async function exportPdf(markdown, fileName, { confirmRemote = async () => false } = {}) {
  const { marked } = await import('marked');
  const tokens = marked.lexer(String(markdown), { gfm: true });
  const remote = findRemoteImages(tokens);
  const allowRemoteImages = remote.length > 0 ? Boolean(await confirmRemote(remote)) : false;
  const [pdfMakeModule, fontsModule, ...courier] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
    // Metrics for the standard Courier font (monospace code blocks); shipped with pdfmake's PDFKit fork.
    import('@foliojs-fork/pdfkit/js/data/Courier.afm?raw'),
    import('@foliojs-fork/pdfkit/js/data/Courier-Bold.afm?raw'),
    import('@foliojs-fork/pdfkit/js/data/Courier-Oblique.afm?raw'),
    import('@foliojs-fork/pdfkit/js/data/Courier-BoldOblique.afm?raw'),
  ]);
  const pdfMake = pdfMakeModule.default || pdfMakeModule;
  const fonts = fontsModule.default || fontsModule;
  const vfs = { ...(fonts.pdfMake ? fonts.pdfMake.vfs : fonts.vfs || fonts) };
  ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'].forEach((name, index) => {
    vfs[`data/${name}.afm`] = courier[index].default;
  });
  pdfMake.vfs = vfs;
  pdfMake.fonts = PDF_FONTS;
  const docDefinition = await buildPdfDocument(tokens, {
    allowRemoteImages,
    loadImage: loadImageAsDataUrl,
    renderMath: renderMathToDataUrl,
    renderMermaid: renderMermaidToDataUrl,
  });
  await new Promise((resolve, reject) => {
    // pdfmake reports some failures asynchronously as uncaught errors; capture them so export never hangs silently.
    const onError = (event) => {
      cleanup();
      reject(event.error || new Error(event.message || 'PDF generation failed.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('PDF generation timed out.'));
    }, 60_000);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('error', onError);
    };
    window.addEventListener('error', onError);
    try {
      pdfMake
        .createPdf(docDefinition)
        .download(`${String(fileName).replace(/\.(md|markdown|mdx|txt)$/i, '') || 'document'}.pdf`, () => {
          cleanup();
          resolve();
        });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
