import { useRef } from 'react';

const Icon = ({ children }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const TOOLBAR_GROUPS = [
  [
    {
      id: 'bold',
      label: 'Bold',
      shortcut: 'bold',
      content: (
        <span className="tool-text" style={{ fontWeight: 700 }}>
          B
        </span>
      ),
    },
    {
      id: 'italic',
      label: 'Italic',
      shortcut: 'italic',
      content: (
        <span className="tool-text" style={{ fontStyle: 'italic' }}>
          I
        </span>
      ),
    },
    {
      id: 'strike',
      label: 'Strikethrough',
      content: (
        <span className="tool-text" style={{ textDecoration: 'line-through' }}>
          S
        </span>
      ),
    },
    {
      id: 'code',
      label: 'Inline code',
      shortcut: 'code',
      content: (
        <Icon>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </Icon>
      ),
    },
  ],
  [
    { id: 'h1', label: 'Heading 1', content: <span className="tool-text">H1</span> },
    { id: 'h2', label: 'Heading 2', content: <span className="tool-text">H2</span> },
    { id: 'h3', label: 'Heading 3', content: <span className="tool-text">H3</span> },
  ],
  [
    {
      id: 'ul',
      label: 'Bulleted list',
      content: (
        <Icon>
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4" cy="6" r="1.5" fill="currentColor" />
          <circle cx="4" cy="12" r="1.5" fill="currentColor" />
          <circle cx="4" cy="18" r="1.5" fill="currentColor" />
        </Icon>
      ),
    },
    {
      id: 'ol',
      label: 'Numbered list',
      content: (
        <Icon>
          <line x1="10" y1="6" x2="21" y2="6" />
          <line x1="10" y1="12" x2="21" y2="12" />
          <line x1="10" y1="18" x2="21" y2="18" />
          <text x="2" y="8" fontSize="7" fill="currentColor" stroke="none">
            1
          </text>
          <text x="2" y="14" fontSize="7" fill="currentColor" stroke="none">
            2
          </text>
          <text x="2" y="20" fontSize="7" fill="currentColor" stroke="none">
            3
          </text>
        </Icon>
      ),
    },
    {
      id: 'task',
      label: 'Task list',
      content: (
        <Icon>
          <rect x="3" y="5" width="6" height="6" rx="1" />
          <line x1="12" y1="8" x2="21" y2="8" />
          <rect x="3" y="13" width="6" height="6" rx="1" />
          <line x1="12" y1="16" x2="21" y2="16" />
          <path d="M4.5 15.5l1.5 1.5 2.5-2.5" />
        </Icon>
      ),
    },
  ],
  [
    {
      id: 'link',
      label: 'Link',
      shortcut: 'link',
      content: (
        <Icon>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </Icon>
      ),
    },
    {
      id: 'image',
      label: 'Image',
      content: (
        <Icon>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </Icon>
      ),
    },
    {
      id: 'quote',
      label: 'Quote',
      content: (
        <Icon>
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21" />
        </Icon>
      ),
    },
    {
      id: 'table',
      label: 'Table',
      content: (
        <Icon>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </Icon>
      ),
    },
    {
      id: 'codeblock',
      label: 'Code block',
      content: (
        <Icon>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <polyline points="8 8 4 12 8 16" />
          <polyline points="16 8 20 12 16 16" />
        </Icon>
      ),
    },
    {
      id: 'hr',
      label: 'Horizontal rule',
      content: (
        <Icon>
          <line x1="3" y1="12" x2="21" y2="12" />
        </Icon>
      ),
    },
  ],
  [
    { id: 'math', label: 'Inline math', content: <span className="tool-text">∑</span> },
    { id: 'mathblock', label: 'Block math', content: <span className="tool-text">∫</span> },
    {
      id: 'mermaid',
      label: 'Mermaid diagram',
      content: (
        <Icon>
          <path d="M12 3v18" />
          <path d="M5 10l7-7 7 7" />
          <circle cx="5" cy="17" r="2" />
          <circle cx="19" cy="17" r="2" />
        </Icon>
      ),
    },
  ],
  [
    {
      id: 'palette',
      label: 'Tools',
      shortcut: 'palette',
      wide: true,
      content: (
        <>
          <Icon>
            <path d="M15 4V2" />
            <path d="M15 16v-2" />
            <path d="M8 9h2" />
            <path d="M20 9h2" />
            <path d="M17.8 11.8 19 13" />
            <path d="M15 9h.01" />
            <path d="M17.8 6.2 19 5" />
            <path d="m3 21 9-9" />
            <path d="M12.2 6.2 11 5" />
          </Icon>
          <span className="tool-label">Tools</span>
        </>
      ),
    },
  ],
];

/** Formatting toolbar: one tab stop, arrow keys move between buttons (roving tabindex). */
export function FormatToolbar({ onAction, shortcutLabel }) {
  const ref = useRef(null);
  const onKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(ref.current.querySelectorAll('button'));
    const index = buttons.indexOf(document.activeElement);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    event.preventDefault();
    buttons.forEach((button, i) => (button.tabIndex = i === next ? 0 : -1));
    buttons[next].focus();
  };
  let first = true;
  return (
    <div
      ref={ref}
      className="floating-toolbar"
      role="toolbar"
      aria-label="Formatting"
      onMouseDown={(event) => event.target.closest('button') && event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {TOOLBAR_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className="toolbar-group" role="group">
          {groupIndex > 0 && <div className="toolbar-separator" role="separator" aria-orientation="vertical" />}
          {group.map((item) => {
            const tabIndex = first ? 0 : -1;
            first = false;
            const keys = item.shortcut ? shortcutLabel(item.shortcut) : '';
            return (
              <button
                key={item.id}
                type="button"
                className={`tool-btn ${item.wide ? 'tool-btn-wide' : ''}`}
                tabIndex={tabIndex}
                aria-label={item.label}
                title={
                  item.id === 'palette'
                    ? `Tools (${keys}) — or right-click in the editor or preview`
                    : keys
                      ? `${item.label} (${keys})`
                      : item.label
                }
                onClick={() => onAction(item.id)}
              >
                {item.content}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
