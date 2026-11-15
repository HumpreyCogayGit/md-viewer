import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MIRROR_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paddingLeft',
  'paddingRight',
  'tabSize',
  'wordSpacing',
  'boxSizing',
];
const MAX_MEASURED_LINES = 20000;

/** Measure the pixel top of each source line in a textarea (soft wrapping included). */
export function measureLineTops(textarea, text, mirror) {
  const style = getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6 || 20;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const lines = text.split('\n');
  if (!mirror || lines.length > MAX_MEASURED_LINES || textarea.clientWidth === 0) {
    return lines.map((_, index) => paddingTop + index * lineHeight);
  }
  for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop];
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.whiteSpace = style.whiteSpace === 'pre' || textarea.wrap === 'off' ? 'pre' : 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.replaceChildren(
    ...lines.map((line) => {
      const div = document.createElement('div');
      div.textContent = line || '​';
      return div;
    }),
  );
  return Array.from(mirror.children, (child) => paddingTop + child.offsetTop);
}

export function EditorPane({
  textareaRef,
  value,
  onChange,
  onKeyDown,
  onScroll,
  onSelect,
  onFocus,
  onPaste,
  onContextMenu,
  lineNumbers,
  wordWrap,
  onLineTops,
  label = 'Markdown source',
}) {
  const mirrorRef = useRef(null);
  const [lineTops, setLineTops] = useState([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  const measure = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const tops = measureLineTops(textarea, textarea.value, mirrorRef.current);
    setLineTops(tops);
    setViewport(textarea.clientHeight);
    onLineTops?.(tops);
  }, [textareaRef, onLineTops]);

  useLayoutEffect(() => {
    const timer = setTimeout(measure, value.length > 200_000 ? 300 : 30);
    return () => clearTimeout(timer);
  }, [value, wordWrap, lineNumbers, measure]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [textareaRef, measure]);

  const handleScroll = (event) => {
    setScrollTop(event.currentTarget.scrollTop);
    onScroll?.(event);
  };

  // Render only gutter numbers near the viewport.
  const visible = [];
  if (lineNumbers) {
    for (let i = 0; i < lineTops.length; i += 1) {
      const top = lineTops[i] - scrollTop;
      if (top < -200) continue;
      if (top > viewport + 200) break;
      visible.push(
        <div key={i} className="gutter-line" style={{ transform: `translateY(${top}px)` }}>
          {i + 1}
        </div>,
      );
    }
  }

  return (
    <div className={`editor-pane ${lineNumbers ? 'with-gutter' : ''}`}>
      {lineNumbers && (
        <div className="gutter" aria-hidden="true">
          {visible}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="markdown-input"
        value={value}
        onChange={onChange}
        onScroll={handleScroll}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        onFocus={onFocus}
        onPaste={onPaste}
        onContextMenu={onContextMenu}
        wrap={wordWrap ? 'soft' : 'off'}
        spellCheck
        aria-label={label}
        aria-describedby="editor-help"
        placeholder="Enter Markdown here…"
      />
      <span id="editor-help" className="sr-only">
        Tab indents, Shift+Tab outdents. Press Escape, then Tab, to move focus out of the editor.
      </span>
      <div ref={mirrorRef} className="editor-mirror" aria-hidden="true" />
    </div>
  );
}
