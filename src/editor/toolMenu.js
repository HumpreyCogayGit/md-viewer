// Builds the right-click "tools" menu from the operation registry. Pure, so the structure is unit tested.
import { suggestOperations } from '../operations/suggestions.js';

/** Submenus shown in the context menu, in order. Each picks operations by category and/or id prefix. */
export const TOOL_GROUPS = [
  { label: 'Format', match: (op) => op.category === 'Format' },
  { label: 'Convert', match: (op) => op.category === 'Structured Data' || op.category === 'Binary Formats' },
  {
    label: 'Encode',
    match: (op) => (op.category === 'Encoding' && op.id.startsWith('encode.')) || op.id.startsWith('escape.'),
  },
  {
    label: 'Decode',
    match: (op) => (op.category === 'Encoding' && op.id.startsWith('decode.')) || op.id.startsWith('unescape.'),
  },
  { label: 'Text', match: (op) => op.category === 'Text' },
  { label: 'Lines', match: (op) => op.category === 'Lines' },
  { label: 'Clean Up', match: (op) => op.category === 'Cleanup' },
  { label: 'Markdown', match: (op) => op.category === 'Markdown' },
  { label: 'Tables', match: (op) => op.category === 'Tables' },
  { label: 'Hash', match: (op) => op.category === 'Hashing' },
  { label: 'Date & Time', match: (op) => op.category === 'Date & Time' },
  {
    label: 'Inspect & Extract',
    match: (op) =>
      ['Tokens & IDs', 'Network', 'Developer', 'Extract', 'Analysis', 'Security Writing'].includes(op.category),
  },
  { label: 'Compress', match: (op) => op.category === 'Compression' },
  { label: 'Validate', match: (op) => op.category === 'Validate' },
  { label: 'Insert', match: (op) => op.category === 'Generate' },
];

const opItem = (operation, hint) => ({
  type: 'item',
  id: `op:${operation.id}`,
  label: operation.name,
  operationId: operation.id,
  hint: hint || operation.description,
  lossy: operation.potentiallyLossy,
  report: operation.outputMode === 'report',
});

/**
 * @returns entries: { type: 'heading' | 'item' | 'submenu' | 'separator', ... }
 */
export function buildToolMenu(
  registry,
  { selectionText = '', recents = [], pane = 'editor', canPaste = true, shortcuts = {} } = {},
) {
  const entries = [];
  const hasSelection = selectionText.trim().length > 0;

  const suggestions = hasSelection ? suggestOperations(selectionText, { registry, limit: 4 }) : [];
  if (suggestions.length) {
    entries.push({ type: 'heading', id: 'h-suggested', label: 'Suggested for selection' });
    suggestions.forEach(({ operationId, reason }) => entries.push(opItem(registry.get(operationId), reason)));
  }

  const suggestedIds = new Set(suggestions.map((s) => s.operationId));
  const recentOps = recents.filter((id) => registry.has(id) && !suggestedIds.has(id)).slice(0, 3);
  if (recentOps.length) {
    entries.push({ type: 'heading', id: 'h-recent', label: 'Recent' });
    recentOps.forEach((id) => entries.push(opItem(registry.get(id))));
  }

  if (entries.length) entries.push({ type: 'separator', id: 's-groups' });
  for (const group of TOOL_GROUPS) {
    const operations = registry.list.filter(group.match);
    if (operations.length === 0) continue;
    entries.push({
      type: 'submenu',
      id: `g:${group.label}`,
      label: group.label,
      items: operations.map((op) => opItem(op)),
    });
  }

  entries.push({ type: 'separator', id: 's-actions' });
  entries.push({
    type: 'item',
    id: 'action:palette',
    label: 'Search all tools…',
    action: 'palette',
    shortcut: shortcuts.palette,
  });
  entries.push({
    type: 'item',
    id: 'action:workbench',
    label: 'Send to Workbench',
    action: 'workbench',
    shortcut: shortcuts.workbench,
  });

  entries.push({ type: 'separator', id: 's-clipboard' });
  if (pane === 'editor')
    entries.push({ type: 'item', id: 'action:cut', label: 'Cut', action: 'cut', disabled: !hasSelection });
  entries.push({ type: 'item', id: 'action:copy', label: 'Copy', action: 'copy', disabled: !hasSelection });
  if (pane === 'editor')
    entries.push({ type: 'item', id: 'action:paste', label: 'Paste', action: 'paste', disabled: !canPaste });

  entries.push({ type: 'note', id: 'n-native', label: 'Shift+right-click for the browser menu' });
  return entries;
}
