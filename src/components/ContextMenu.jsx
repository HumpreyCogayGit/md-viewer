import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

/** Keep a fixed-position element inside the viewport; flip to the left of `anchor` when there is no room on the right. */
function place(element, { x, y, anchor }) {
  const margin = 8;
  const { width, height } = element.getBoundingClientRect();
  let left = x;
  let top = y;
  if (anchor && left + width > window.innerWidth - margin) left = anchor.left - width;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function MenuList({ entries, position, onSelect, onCloseAll, onCloseSelf, label, level = 0, autoFocus = true }) {
  const ref = useRef(null);
  const [openId, setOpenId] = useState(null);
  const [submenuPosition, setSubmenuPosition] = useState(null);

  useLayoutEffect(() => {
    if (ref.current) place(ref.current, position);
  }, [position]);

  useEffect(() => {
    // Submenus opened by hovering do not take focus; opened with → / Enter / click they do.
    if (autoFocus) ref.current?.querySelector(ITEM_SELECTOR)?.focus();
  }, [autoFocus]);

  const items = () => Array.from(ref.current?.querySelectorAll(`:scope > ${ITEM_SELECTOR}`) || []);

  const openSubmenu = (entry, trigger, focusFirst) => {
    const rect = trigger.getBoundingClientRect();
    setSubmenuPosition({ x: rect.right - 2, y: rect.top - 4, anchor: rect, focusFirst });
    setOpenId(entry.id);
  };

  const onKeyDown = (event) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    const current = list[index];
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        list[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        list.at(-1)?.focus();
        break;
      case 'ArrowRight':
        if (current?.getAttribute('aria-haspopup') === 'menu') {
          event.preventDefault();
          const entry = entries.find((e) => e.id === current.dataset.id);
          openSubmenu(entry, current, true);
        }
        break;
      case 'ArrowLeft':
        if (level > 0) {
          event.preventDefault();
          onCloseSelf();
        }
        break;
      case 'Escape':
        event.preventDefault();
        if (level > 0) onCloseSelf();
        else onCloseAll();
        break;
      case 'Tab':
        event.preventDefault();
        onCloseAll();
        break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const key = event.key.toLowerCase();
          const ordered = [...list.slice(index + 1), ...list.slice(0, index + 1)];
          ordered.find((item) => item.textContent.trim().toLowerCase().startsWith(key))?.focus();
        }
    }
    event.stopPropagation();
  };

  // Long submenus scroll; the root menu uses the full viewport height so its actions stay visible.
  const scrollable = level > 0 && entries.length > 14;
  const body = entries.map((entry) => {
    if (entry.type === 'separator') return <div key={entry.id} role="separator" className="menu-divider" />;
    if (entry.type === 'heading')
      return (
        <div key={entry.id} className="context-menu-heading" role="presentation">
          {entry.label}
        </div>
      );
    if (entry.type === 'note')
      return (
        <div key={entry.id} className="context-menu-note" role="presentation">
          {entry.label}
        </div>
      );
    if (entry.type === 'submenu') {
      const open = openId === entry.id;
      return (
        <div
          key={entry.id}
          data-id={entry.id}
          role="menuitem"
          tabIndex={-1}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`context-menu-item ${open ? 'open' : ''}`}
          onMouseEnter={(event) => openSubmenu(entry, event.currentTarget, false)}
          onClick={(event) => openSubmenu(entry, event.currentTarget, true)}
        >
          <span>{entry.label}</span>
          <span className="context-menu-meta">{entry.items.length} ›</span>
        </div>
      );
    }
    return (
      <div
        key={entry.id}
        data-id={entry.id}
        role="menuitem"
        tabIndex={-1}
        aria-disabled={entry.disabled || undefined}
        title={entry.hint}
        className="context-menu-item"
        onMouseEnter={() => setOpenId(null)}
        onClick={() => !entry.disabled && onSelect(entry)}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !entry.disabled) {
            event.preventDefault();
            event.stopPropagation();
            onSelect(entry);
          }
        }}
      >
        <span className="context-menu-label">
          {entry.label}
          {entry.hint && entry.operationId && level === 0 && <span className="context-menu-hint">{entry.hint}</span>}
        </span>
        <span className="context-menu-meta">
          {entry.lossy && <span title="Shows a preview first">◐</span>}
          {entry.report && <span title="Shows a report">≡</span>}
          {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
        </span>
      </div>
    );
  });

  const submenu = entries.find((entry) => entry.id === openId && entry.type === 'submenu');
  return (
    <>
      <div
        ref={ref}
        className={`context-menu ${scrollable ? 'context-menu-scrollable' : ''}`}
        role="menu"
        aria-label={label}
        style={{ left: position.x, top: position.y }}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
      >
        {body}
      </div>
      {submenu && submenuPosition && (
        <MenuList
          key={submenu.id}
          entries={submenu.items}
          position={submenuPosition}
          onSelect={onSelect}
          onCloseAll={onCloseAll}
          onCloseSelf={() => {
            setOpenId(null);
            ref.current?.querySelector(`[data-id="${CSS.escape(submenu.id)}"]`)?.focus();
          }}
          label={submenu.label}
          level={level + 1}
          autoFocus={submenuPosition.focusFirst}
        />
      )}
    </>
  );
}

/**
 * Right-click menu with flyout submenus. Arrow keys navigate, → opens and ← closes a submenu, Enter runs,
 * Escape closes, and focus returns to where it was.
 */
export function ContextMenu({ entries, x, y, onSelect, onClose, label = 'Tools' }) {
  const rootRef = useRef(null);
  useEffect(() => {
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) onClose();
    };
    const onViewportChange = () => onClose();
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('blur', onViewportChange);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('blur', onViewportChange);
    };
  }, [onClose]);

  return (
    <div ref={rootRef} className="context-menu-root">
      <MenuList
        entries={entries}
        position={{ x, y }}
        onSelect={(entry) => {
          onClose();
          onSelect(entry);
        }}
        onCloseAll={onClose}
        onCloseSelf={onClose}
        label={label}
      />
    </div>
  );
}
