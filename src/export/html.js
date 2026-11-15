// Standalone HTML export and rich-text copy.

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const BASE_CSS = `
:root { color-scheme: light dark; }
body { margin: 0; background: #fff; color: #1b1b1f; font: 16px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
main { max-width: 820px; margin: 0 auto; padding: 48px 24px; }
img, svg { max-width: 100%; height: auto; }
pre { overflow-x: auto; }
@media print { main { padding: 0; } }
`;

/**
 * Build a self-contained HTML document. `bodyHtml` must already be sanitized; `css` is inlined so the file works
 * offline and without the app.
 */
export function buildStandaloneHtml(bodyHtml, { title = 'Document', css = '', theme = 'light' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Speculo">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}
${css.replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body>
<main class="md-viewer-container ${theme === 'dark' ? 'dark' : 'light'}"><article class="preview-area">
${bodyHtml}
</article></main>
</body>
</html>
`;
}

/** Same-origin CSS rules from the page, for inlining. Cross-origin sheets are skipped. */
export function collectPageCss(doc = globalThis.document) {
  const parts = [];
  for (const sheet of Array.from(doc?.styleSheets || [])) {
    try {
      for (const rule of Array.from(sheet.cssRules || [])) parts.push(rule.cssText);
    } catch {
      // Cross-origin stylesheet; its rules are not readable.
    }
  }
  return parts.join('\n');
}

export async function sanitizeHtml(html) {
  const { default: DOMPurify } = await import('dompurify');
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_TAGS: ['foreignObject'],
    FORBID_TAGS: ['style', 'script'],
    FORBID_ATTR: ['onerror', 'onload'],
  });
}

/** Copy HTML as rich text (with a plain-text fallback). */
export async function copyRichText(html, plainText) {
  if (globalThis.ClipboardItem && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ]);
    return 'rich';
  }
  await navigator.clipboard.writeText(plainText);
  return 'plain';
}
