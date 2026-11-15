import { useMemo } from 'react';
import { extractHeadings } from '../operations/markdown/markdown.js';
import { SHORTCUTS, formatShortcut } from '../editor/shortcuts.js';
import { Dialog } from './Dialog.jsx';

export function OutlinePanel({ markdown, cursorLine, onJump, onClose }) {
  const headings = useMemo(() => extractHeadings(markdown), [markdown]);
  const activeIndex = headings.findLastIndex((heading) => heading.line + 1 <= cursorLine);
  return (
    <nav className="outline-panel" aria-label="Document outline">
      <header className="panel-header">
        <h2>Outline</h2>
        <button type="button" className="icon-btn" aria-label="Close outline" onClick={onClose}>
          ×
        </button>
      </header>
      {headings.length === 0 ? (
        <p className="muted panel-empty">No headings yet.</p>
      ) : (
        <ul>
          {headings.map((heading, index) => (
            <li key={`${heading.line}-${heading.slug}`} style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}>
              <button
                type="button"
                className={`outline-item ${index === activeIndex ? 'active' : ''}`}
                aria-current={index === activeIndex ? 'location' : undefined}
                onClick={() => onJump(heading.line + 1)}
              >
                {heading.text || '(empty heading)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

export function ShortcutsDialog({ mac, onClose }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <table className="shortcut-table">
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Shortcut</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.filter((shortcut) => !shortcut.hidden).map((shortcut) => (
            <tr key={shortcut.id}>
              <td>{shortcut.label}</td>
              <td>
                <kbd>{formatShortcut(shortcut.keys, mac)}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">In the operation palette: ↑/↓ to move, Enter to run, {mac ? '⌘' : 'Ctrl'}+D to favourite.</p>
    </Dialog>
  );
}

export function StatusBar({ stats, saveState, fileName }) {
  return (
    <footer className="status-bar" aria-label="Document status">
      <span title="File">{fileName}</span>
      <span>{saveState}</span>
      <span className="spacer" />
      <span>
        Ln {stats.cursorLine}, Col {stats.cursorColumn}
      </span>
      {stats.selectionCharacters > 0 && (
        <span>
          {stats.selectionCharacters.toLocaleString()} selected ({stats.selectionWords} words)
        </span>
      )}
      <span>{stats.words.toLocaleString()} words</span>
      <span>{stats.characters.toLocaleString()} chars</span>
      <span>{stats.lines.toLocaleString()} lines</span>
      <span>~{stats.readingMinutes} min read</span>
    </footer>
  );
}

export function TabBar({ documents, activeId, onSelect, onClose, onNew }) {
  const onKeyDown = (event, index) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = documents[(index + (event.key === 'ArrowRight' ? 1 : -1) + documents.length) % documents.length];
    onSelect(next.id);
    requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
  };
  return (
    <div className="tab-bar">
      <div role="tablist" aria-label="Open documents" className="tab-list">
        {documents.map((doc, index) => (
          <div key={doc.id} className={`tab ${doc.id === activeId ? 'active' : ''}`}>
            <button
              type="button"
              id={`tab-${doc.id}`}
              role="tab"
              aria-selected={doc.id === activeId}
              tabIndex={doc.id === activeId ? 0 : -1}
              className="tab-label"
              onClick={() => onSelect(doc.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              title={doc.fileName}
            >
              {doc.dirty && (
                <span className="dirty-dot" aria-label="unsaved changes">
                  ●
                </span>
              )}{' '}
              {doc.fileName}
            </button>
            {documents.length > 1 && (
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${doc.fileName}`}
                onClick={() => onClose(doc.id)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="icon-btn" aria-label="New document" title="New document" onClick={onNew}>
        +
      </button>
    </div>
  );
}

export function ConsentBanner({ onAccept, onDecline }) {
  return (
    <div className="consent-banner" role="region" aria-label="Analytics consent">
      <p>
        Speculo can send anonymous usage analytics (Google Analytics). Your documents and operation inputs are never
        sent. Analytics stay off unless you allow them.
      </p>
      <div className="consent-actions">
        <button type="button" className="btn" onClick={onDecline}>
          No thanks
        </button>
        <button type="button" className="btn btn-primary" onClick={onAccept}>
          Allow analytics
        </button>
      </div>
    </div>
  );
}
