import { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeSourcePositions } from '../preview/rehypeSourcePositions.js';
import { remarkStripComments } from '../preview/remarkStripComments.js';
import { highlightCode, loadHighlighter } from '../preview/highlight.js';
import { renderMermaidSvg } from '../preview/mermaid.js';

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;

/** Allow safe data: images (QR codes, embedded images); everything else goes through react-markdown's safe default. */
export function urlTransform(url, key) {
  if (key === 'src' && SAFE_DATA_IMAGE.test(url)) return url;
  return defaultUrlTransform(url);
}

export const isRemoteImage = (src) => /^(https?:)?\/\//i.test(String(src || ''));

async function sanitizeSvg(svg) {
  const { default: DOMPurify } = await import('dompurify');
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
    FORBID_TAGS: ['script'],
    FORBID_ATTR: ['onclick', 'onload', 'onerror'],
  });
}

export function MermaidDiagram({ code, theme }) {
  const [state, setState] = useState({ svg: '', error: '' });
  useEffect(() => {
    let cancelled = false;
    renderMermaidSvg(code, theme === 'dark' ? 'dark' : 'default')
      .then(sanitizeSvg)
      .then((svg) => !cancelled && setState({ svg, error: '' }))
      .catch((error) => !cancelled && setState({ svg: '', error: error?.message || 'Invalid Mermaid syntax' }));
    return () => {
      cancelled = true;
    };
  }, [code, theme]);
  if (state.error)
    return (
      <pre className="mermaid-error" role="note">
        {state.error}
      </pre>
    );
  if (!state.svg)
    return (
      <div className="mermaid-diagram mermaid-loading" aria-busy="true">
        Rendering diagram…
      </div>
    );
  // Sanitized with DOMPurify; Mermaid renders in strict security mode.
  return (
    <div
      className="mermaid-diagram"
      role="img"
      aria-label="Mermaid diagram"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}

function CodeBlock({ code, language, hljs }) {
  const highlighted = useMemo(() => (hljs ? highlightCode(hljs, code, language) : null), [hljs, code, language]);
  if (highlighted) {
    // highlight.js escapes the code, so its HTML output is safe.
    return (
      <code
        className={`hljs language-${highlighted.language}`}
        dangerouslySetInnerHTML={{ __html: highlighted.html }}
      />
    );
  }
  return <code className={language ? `language-${language}` : undefined}>{code}</code>;
}

function RemoteImage({ src, alt, title, block, onAllow }) {
  if (!block) return <img src={src} alt={alt || ''} title={title} loading="lazy" referrerPolicy="no-referrer" />;
  return (
    <button type="button" className="blocked-image" onClick={() => onAllow?.(src)} title={`Load image from ${src}`}>
      🖼 {alt || 'Remote image'} — blocked for privacy. Click to load from{' '}
      {(() => {
        try {
          return new URL(src, window.location.href).host;
        } catch {
          return 'remote host';
        }
      })()}
      .
    </button>
  );
}

function MarkdownPreviewImpl({ markdown, theme, blockRemoteImages, allowedImages, onAllowImage }) {
  const hasMath = /\$/.test(markdown);
  const hasCode = /```|~~~|^ {4}\S/m.test(markdown);
  const [math, setMath] = useState(null);
  const [hljs, setHljs] = useState(null);

  useEffect(() => {
    if (hasMath && !math) import('../preview/math.js').then((module) => setMath(module));
  }, [hasMath, math]);
  useEffect(() => {
    if (hasCode && !hljs)
      loadHighlighter()
        .then(setHljs)
        .catch(() => {});
  }, [hasCode, hljs]);

  const remarkPlugins = useMemo(
    () => (math ? [remarkGfm, remarkStripComments, math.remarkMath] : [remarkGfm, remarkStripComments]),
    [math],
  );
  const rehypePlugins = useMemo(
    () =>
      math
        ? [[math.rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false }], rehypeSourcePositions]
        : [rehypeSourcePositions],
    [math],
  );

  const components = useMemo(
    () => ({
      pre({ node, children: _children, ...props }) {
        const codeNode = node?.children?.find((child) => child.tagName === 'code');
        const className = codeNode?.properties?.className?.join?.(' ') || '';
        const language = /language-([\w+#-]+)/.exec(className)?.[1]?.toLowerCase() || '';
        const code = (codeNode?.children || [])
          .map((child) => child.value || '')
          .join('')
          .replace(/\n$/, '');
        if (language === 'mermaid') return <MermaidDiagram code={code} theme={theme} />;
        return (
          <pre {...props}>
            <CodeBlock code={code} language={language} hljs={hljs} />
          </pre>
        );
      },
      // Inline code is rendered as-is: it is never run through block-level detectors (regression).
      code({ node: _node, ...props }) {
        return <code {...props} />;
      },
      img({ node: _node, src, alt, title }) {
        if (isRemoteImage(src))
          return (
            <RemoteImage
              src={src}
              alt={alt}
              title={title}
              block={blockRemoteImages && !allowedImages?.has(src)}
              onAllow={onAllowImage}
            />
          );
        return <img src={src} alt={alt || ''} title={title} loading="lazy" />;
      },
      a({ node: _node, href, children, ...props }) {
        const external = /^https?:/i.test(href || '');
        return (
          <a href={href} {...props} {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}>
            {children}
          </a>
        );
      },
    }),
    [theme, hljs, blockRemoteImages, allowedImages, onAllowImage],
  );

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
      urlTransform={urlTransform}
    >
      {markdown}
    </ReactMarkdown>
  );
}

export const MarkdownPreview = memo(MarkdownPreviewImpl);
