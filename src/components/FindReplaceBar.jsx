import { useEffect, useMemo, useRef, useState } from 'react';
import { findMatches, replaceAll, replaceMatch } from '../editor/textEditing.js';

/** Find & replace for the editor (literal or regex). Selecting a match moves the editor selection to it. */
export function FindReplaceBar({
  text,
  selectionStart,
  showReplace,
  onSelect,
  onReplaceText,
  onClose,
  initialQuery = '',
}) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [current, setCurrent] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [showReplace]);

  const options = { regex, caseSensitive, wholeWord };
  const { matches, error, pattern } = useMemo(
    () => findMatches(text, query, { regex, caseSensitive, wholeWord }),
    [text, query, regex, caseSensitive, wholeWord],
  );

  const go = (direction) => {
    if (matches.length === 0) return;
    let index;
    if (current === -1 || current >= matches.length) {
      index =
        direction > 0
          ? matches.findIndex((m) => m.start >= selectionStart)
          : matches.findLastIndex((m) => m.start < selectionStart);
      if (index === -1) index = direction > 0 ? 0 : matches.length - 1;
    } else {
      index = (current + direction + matches.length) % matches.length;
    }
    setCurrent(index);
    onSelect(matches[index]);
  };

  const replaceCurrent = () => {
    const match = matches[current] ?? matches.find((m) => m.start >= selectionStart) ?? matches[0];
    if (!match) return;
    const result = replaceMatch(text, match, replacement, { regex, pattern });
    onReplaceText(result.text, { start: result.start, end: result.end });
    setCurrent(-1);
  };

  const replaceEverything = () => {
    const result = replaceAll(text, query, replacement, options);
    if (result.count)
      onReplaceText(result.text, null, `Replaced ${result.count} occurrence${result.count === 1 ? '' : 's'}.`);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(event.shiftKey ? -1 : 1);
    }
  };

  const count = error ? 'Invalid pattern' : query ? `${current >= 0 ? current + 1 : 0} of ${matches.length}` : '';
  return (
    <div className="find-bar" role="search" aria-label="Find and replace in document" onKeyDown={onKeyDown}>
      <div className="find-row">
        <input
          ref={inputRef}
          type="text"
          aria-label="Find"
          placeholder="Find"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCurrent(-1);
          }}
          spellCheck={false}
          aria-invalid={Boolean(error)}
        />
        <span className="find-count" aria-live="polite">
          {count}
        </span>
        <button
          type="button"
          className="toggle-btn"
          aria-pressed={caseSensitive}
          title="Match case"
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </button>
        <button
          type="button"
          className="toggle-btn"
          aria-pressed={wholeWord}
          title="Whole word"
          onClick={() => setWholeWord((v) => !v)}
        >
          W
        </button>
        <button
          type="button"
          className="toggle-btn"
          aria-pressed={regex}
          title="Regular expression"
          onClick={() => setRegex((v) => !v)}
        >
          .*
        </button>
        <button type="button" className="icon-btn" aria-label="Previous match" onClick={() => go(-1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" aria-label="Next match" onClick={() => go(1)}>
          ↓
        </button>
        <button type="button" className="icon-btn" aria-label="Close find" onClick={onClose}>
          ×
        </button>
      </div>
      {showReplace && (
        <div className="find-row">
          <input
            type="text"
            aria-label="Replace with"
            placeholder={regex ? 'Replace ($1 for groups)' : 'Replace'}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            spellCheck={false}
          />
          <button type="button" className="btn btn-small" onClick={replaceCurrent} disabled={!matches.length}>
            Replace
          </button>
          <button type="button" className="btn btn-small" onClick={replaceEverything} disabled={!matches.length}>
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
