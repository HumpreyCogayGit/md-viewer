import { useEffect, useId, useRef, useState } from 'react';

/**
 * Accessible menu button: aria-expanded/controls, role=menu with grouped items, arrow-key/Home/End navigation,
 * Escape closes and returns focus to the button, Tab closes.
 */
export function AppMenu({ sections, label = 'Main menu' }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const items = () => Array.from(menuRef.current?.querySelectorAll('[role^="menuitem"]:not([disabled])') || []);

  useEffect(() => {
    if (!open) return undefined;
    requestAnimationFrame(() => items()[0]?.focus());
    const onPointer = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      list.at(-1)?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const next = list
        .slice(index + 1)
        .concat(list.slice(0, index + 1))
        .find((item) => item.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));
      next?.focus();
    }
  };

  return (
    <div className="hamburger-menu">
      <button
        ref={buttonRef}
        type="button"
        className="hamburger-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="dropdown-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {sections.map((section, sectionIndex) => (
            <div
              key={section.title}
              role="group"
              aria-labelledby={`${menuId}-s${sectionIndex}`}
              className="menu-section"
            >
              {sectionIndex > 0 && <div className="menu-divider" role="separator" />}
              <div id={`${menuId}-s${sectionIndex}`} className="menu-section-title">
                {section.title}
              </div>
              <div className={section.columns ? 'menu-submenu' : undefined}>
                {section.items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    aria-checked={item.checked === undefined ? undefined : item.checked}
                    className="menu-item"
                    tabIndex={-1}
                    disabled={item.disabled}
                    title={item.title}
                    onClick={() => {
                      close(!item.keepFocus);
                      item.onSelect();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.checked !== undefined && <span aria-hidden="true">{item.checked ? '✓' : ''}</span>}
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
