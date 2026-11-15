import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Docked panel for report-style results (hashes, inspections, statistics). Never modifies the document. */
export function ResultPanel({ result, onClose, onInsert, onCopy }) {
  const [raw, setRaw] = useState(false);
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [result]);
  if (!result) return null;
  return (
    <aside
      className="result-panel"
      aria-label={`${result.title} result`}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <header className="result-header">
        <h2 ref={headingRef} tabIndex={-1}>
          {result.title}
        </h2>
        <div className="result-actions">
          <button type="button" className="btn btn-small" aria-pressed={raw} onClick={() => setRaw((value) => !value)}>
            {raw ? 'Rendered' : 'Raw'}
          </button>
          <button type="button" className="btn btn-small" onClick={onCopy}>
            Copy
          </button>
          <button type="button" className="btn btn-small" onClick={onInsert}>
            Insert at cursor
          </button>
          <button type="button" className="icon-btn" aria-label="Close result" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      {result.notes && <p className="muted result-note">ℹ️ {result.notes}</p>}
      {result.warnings?.length > 0 && (
        <ul className="warning-list">
          {result.warnings.map((warning) => (
            <li key={warning}>⚠️ {warning}</li>
          ))}
        </ul>
      )}
      <div className="result-body" tabIndex={0}>
        {raw ? (
          <pre>{result.output}</pre>
        ) : (
          <div className="preview-area result-rendered">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.output}</ReactMarkdown>
          </div>
        )}
      </div>
    </aside>
  );
}
