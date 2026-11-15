// Keyboard shortcut definitions, matching, and platform-aware labels.

export const SHORTCUTS = [
  { id: 'open', keys: 'Mod+O', label: 'Open file' },
  { id: 'save', keys: 'Mod+S', label: 'Save' },
  { id: 'saveAs', keys: 'Mod+Shift+S', label: 'Save as…' },
  { id: 'newTab', keys: 'Mod+Alt+N', label: 'New document tab' },
  { id: 'bold', keys: 'Mod+B', label: 'Bold' },
  { id: 'italic', keys: 'Mod+I', label: 'Italic' },
  { id: 'link', keys: 'Mod+K', label: 'Insert link' },
  { id: 'code', keys: 'Mod+E', label: 'Inline code' },
  { id: 'palette', keys: 'Mod+Shift+P', label: 'Operation palette' },
  { id: 'find', keys: 'Mod+F', label: 'Find' },
  { id: 'replace', keys: 'Mod+Alt+F', label: 'Find and replace' },
  { id: 'undo', keys: 'Mod+Z', label: 'Undo' },
  { id: 'redo', keys: 'Mod+Shift+Z', label: 'Redo' },
  { id: 'redoAlt', keys: 'Mod+Y', label: 'Redo', hidden: true },
  { id: 'workbench', keys: 'Mod+Shift+K', label: 'Toggle workbench' },
  { id: 'outline', keys: 'Mod+Shift+O', label: 'Toggle outline' },
  { id: 'shortcuts', keys: 'Mod+/', label: 'Keyboard shortcuts' },
  { id: 'indent', keys: 'Tab', label: 'Indent line(s)', editorOnly: true },
  { id: 'outdent', keys: 'Shift+Tab', label: 'Outdent line(s)', editorOnly: true },
  { id: 'escape', keys: 'Escape', label: 'Leave the editor (so Tab moves focus)', editorOnly: true },
];

export function isMacPlatform(
  platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '',
) {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const MAC_SYMBOLS = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };

/** "Mod+Shift+P" → "⌘⇧P" on macOS, "Ctrl+Shift+P" elsewhere. */
export function formatShortcut(keys, mac = isMacPlatform()) {
  const parts = keys.split('+');
  if (mac) return parts.map((part) => MAC_SYMBOLS[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join('');
  return parts.map((part) => (part === 'Mod' ? 'Ctrl' : part.length === 1 ? part.toUpperCase() : part)).join('+');
}

/** Does a keyboard event match "Mod+Shift+P"? Mod is ⌘ on macOS and Ctrl elsewhere. */
export function matchShortcut(event, keys, mac = isMacPlatform()) {
  const parts = keys.split('+');
  const key = parts.at(-1);
  const wants = new Set(parts.slice(0, -1));
  const mod = mac ? event.metaKey : event.ctrlKey;
  if (wants.has('Mod') !== Boolean(mod)) return false;
  if (wants.has('Shift') !== Boolean(event.shiftKey)) return false;
  if (wants.has('Alt') !== Boolean(event.altKey)) return false;
  if (!wants.has('Mod') && (event.metaKey || event.ctrlKey)) return false;
  const eventKey = event.key?.length === 1 ? event.key.toLowerCase() : event.key;
  const code = event.code || '';
  const target = key.length === 1 ? key.toLowerCase() : key;
  // With Alt/Shift held, `key` may be a different character (⌥F = ƒ), so also compare the physical key.
  return eventKey === target || code === `Key${key.toUpperCase()}` || (key === '/' && code === 'Slash');
}

export function findShortcut(event, mac = isMacPlatform()) {
  return SHORTCUTS.find((shortcut) => matchShortcut(event, shortcut.keys, mac)) || null;
}

export const shortcutLabel = (id, mac) => {
  const shortcut = SHORTCUTS.find((item) => item.id === id);
  return shortcut ? formatShortcut(shortcut.keys, mac) : '';
};
