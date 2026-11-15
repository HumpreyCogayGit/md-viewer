import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { orderedGroups } from '../operations/catalog.js';
import { KEYS, pushRecent, readJson, writeJson } from '../editor/storage.js';
import { Dialog } from './Dialog.jsx';
import { OperationBadges, OperationOptionsForm, defaultOptionValues } from './OperationOptionsForm.jsx';

const MAX_RESULTS = 120;

/** Operations whose options need user input (an empty text field) open the options form; others run with defaults. */
export const needsInput = (operation) =>
  operation.options.some(
    (option) => (option.type === 'text' || option.type === 'textarea') && option.default === '' && !option.optional,
  );

/**
 * Searchable operation palette. In `run` mode the chosen operation is executed; in `pick` mode it is returned
 * (used by the workbench to add recipe steps).
 */
export function OperationPalette({
  registry,
  onClose,
  onRun,
  suggestions = [],
  mode = 'run',
  initialPreview = false,
  title,
  initialOperationId,
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Opened from the context menu for a tool that needs input: start on its option form.
  const [selected, setSelected] = useState(() => (initialOperationId ? registry.get(initialOperationId) : null));
  const [optionValues, setOptionValues] = useState(() =>
    initialOperationId ? defaultOptionValues(registry.get(initialOperationId)) : {},
  );
  const [preview, setPreview] = useState(initialPreview);
  const [favourites, setFavourites] = useState(() => readJson(KEYS.paletteFavourites, []));
  const [recents, setRecents] = useState(() => readJson(KEYS.paletteRecents, []));
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const sections = useMemo(() => {
    const valid = (ids) => ids.filter((id) => registry.has(id)).map((id) => registry.get(id));
    if (query.trim()) {
      // Keep relevance order: groups appear in the order of their best-ranked operation.
      const results = registry.search(query).slice(0, MAX_RESULTS);
      return registry.grouped(results).map((group) => ({ title: group.category, items: group.operations }));
    }
    const pinned = [
      {
        title: 'Suggested for this selection',
        items: valid(suggestions.map((s) => s.operationId)),
        reasons: Object.fromEntries(suggestions.map((s) => [s.operationId, s.reason])),
      },
      { title: 'Favourites', items: valid(favourites) },
      {
        title: 'Recent',
        items: valid(recents)
          .filter((op) => !favourites.includes(op.id))
          .slice(0, 6),
      },
    ].filter((section) => section.items.length);
    return [...pinned, ...orderedGroups(registry).map((group) => ({ title: group.category, items: group.operations }))];
  }, [query, registry, suggestions, favourites, recents]);

  const flat = useMemo(
    () =>
      sections.flatMap((section, s) =>
        section.items.map((operation, i) => ({
          operation,
          key: `${s}-${i}-${operation.id}`,
          reason: section.reasons?.[operation.id],
        })),
      ),
    [sections],
  );

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const toggleFavourite = (id) => {
    const next = favourites.includes(id) ? favourites.filter((item) => item !== id) : [id, ...favourites];
    setFavourites(next);
    writeJson(KEYS.paletteFavourites, next);
  };

  const run = (operation, values, withPreview) => {
    setRecents(pushRecent(KEYS.paletteRecents, operation.id, { limit: 12 }));
    onRun(operation.id, values, { preview: withPreview });
  };

  const openOptions = (operation) => {
    setSelected(operation);
    setOptionValues(defaultOptionValues(operation));
  };

  const choose = (operation, { forceOptions = false } = {}) => {
    if (!operation) return;
    if (forceOptions ? operation.options.length > 0 : needsInput(operation)) {
      setSelected(operation);
      setOptionValues(defaultOptionValues(operation));
      return;
    }
    run(operation, {}, preview || operation.potentiallyLossy);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(flat.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home' && event.ctrlKey) {
      setActiveIndex(0);
    } else if (event.key === 'End' && event.ctrlKey) {
      setActiveIndex(flat.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(flat[activeIndex]?.operation, { forceOptions: event.shiftKey || mode === 'pick' });
    } else if (event.key.toLowerCase() === 'd' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (flat[activeIndex]) toggleFavourite(flat[activeIndex].operation.id);
    }
  };

  if (selected) {
    const runSelected = (event) => {
      event?.preventDefault();
      run(selected, optionValues, preview || selected.potentiallyLossy);
    };
    return (
      <Dialog title={selected.name} onClose={() => (initialOperationId ? onClose() : setSelected(null))} wide>
        <form
          className="palette-options"
          onSubmit={runSelected}
          onKeyDown={(event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey) && runSelected(event)}
        >
          <p className="muted">{selected.description}</p>
          <OperationBadges operation={selected} />
          {selected.lossyWarning && <p className="warning-text">⚠️ {selected.lossyWarning}</p>}
          {selected.notes && <p className="muted">ℹ️ {selected.notes}</p>}
          <OperationOptionsForm operation={selected} values={optionValues} onChange={setOptionValues} />
          <div className="dialog-actions">
            {mode === 'run' && selected.outputMode !== 'report' && (
              <label className="option-checkbox">
                <input
                  type="checkbox"
                  checked={preview || selected.potentiallyLossy}
                  disabled={selected.potentiallyLossy}
                  onChange={(event) => setPreview(event.target.checked)}
                />
                <span>Preview before applying</span>
              </label>
            )}
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => (initialOperationId ? onClose() : setSelected(null))}>
              {initialOperationId ? 'Cancel' : 'Back'}
            </button>
            <button type="submit" className="btn btn-primary">
              {mode === 'pick' ? 'Add step' : 'Run'}
            </button>
          </div>
        </form>
      </Dialog>
    );
  }

  const activeId = flat[activeIndex] ? `${listId}-${activeIndex}` : undefined;
  let flatIndex = -1;
  return (
    <Dialog
      title={title || (mode === 'pick' ? 'Add recipe step' : 'Operations')}
      onClose={onClose}
      initialFocusRef={inputRef}
      wide
      className="palette"
    >
      <input
        ref={inputRef}
        className="palette-search"
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-label="Search operations"
        placeholder="Search operations (e.g. base64, prettify, epoch, toc)…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      {mode === 'run' && (
        <label className="option-checkbox palette-preview-toggle">
          <input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} />
          <span>Preview before applying</span>
        </label>
      )}
      <div ref={listRef} id={listId} role="listbox" aria-label="Operations" className="palette-list">
        {flat.length === 0 && <p className="muted palette-empty">No operations match “{query}”.</p>}
        {sections.map((section) => (
          <div key={section.title} role="group" aria-label={section.title}>
            <div className="palette-group-title" aria-hidden="true">
              {section.title}
            </div>
            {section.items.map((operation) => {
              flatIndex += 1;
              const index = flatIndex;
              const isActive = index === activeIndex;
              const reason = section.reasons?.[operation.id];
              const isFavourite = favourites.includes(operation.id);
              return (
                <div
                  key={`${section.title}-${operation.id}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isActive}
                  className={`palette-item ${isActive ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  // Keep keyboard focus in the search box when clicking an item or its buttons.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(operation, { forceOptions: mode === 'pick' })}
                >
                  <div className="palette-item-main">
                    <span className="palette-item-name">{operation.name}</span>
                    <span className="palette-item-desc">{reason || operation.description}</span>
                  </div>
                  <OperationBadges operation={operation} />
                  {operation.options.length > 0 && mode === 'run' && (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="star-btn"
                      aria-label={`Options for ${operation.name}`}
                      title="Options (Shift+Enter)"
                      onClick={(event) => {
                        event.stopPropagation();
                        openOptions(operation);
                      }}
                    >
                      ⚙
                    </button>
                  )}
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`star-btn ${isFavourite ? 'starred' : ''}`}
                    aria-label={
                      isFavourite ? `Remove ${operation.name} from favourites` : `Add ${operation.name} to favourites`
                    }
                    aria-pressed={isFavourite}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavourite(operation.id);
                    }}
                  >
                    {isFavourite ? '★' : '☆'}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="palette-hint muted">
        ↑↓ to move · Enter to run · Shift+Enter for options · {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+D to
        favourite · Esc to close
      </p>
    </Dialog>
  );
}
