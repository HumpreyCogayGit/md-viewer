// Undo/redo history with grouped typing and selection restore.
//
// Entries are { text, selection, selectionBefore }. Consecutive typing within `groupMs` is merged into one entry,
// so undo removes a burst of typing instead of a single keystroke. Undo restores the caret to where it was before
// the undone change; redo restores the caret to where it was after it.

export function createHistory(initialText = '', { limit = 500, groupMs = 1000 } = {}) {
  let entries = [{ text: initialText, selection: { start: 0, end: 0 }, selectionBefore: { start: 0, end: 0 } }];
  let index = 0;
  let lastKind = null;
  let lastTime = 0;

  return {
    get current() {
      return entries[index];
    },
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index < entries.length - 1;
    },
    get size() {
      return entries.length;
    },
    /** Record a new document state. `kind` is 'typing' for keystrokes and anything else for discrete edits. */
    record(text, { selectionBefore, selectionAfter, kind = 'edit', now = Date.now() } = {}) {
      if (text === entries[index].text) {
        entries[index] = { ...entries[index], selection: selectionAfter ?? entries[index].selection };
        return false;
      }
      const after = selectionAfter ?? { start: text.length, end: text.length };
      const canMerge =
        kind === 'typing' &&
        lastKind === 'typing' &&
        now - lastTime < groupMs &&
        index === entries.length - 1 &&
        index > 0;
      if (canMerge) {
        entries[index] = { ...entries[index], text, selection: after };
      } else {
        entries = entries.slice(0, index + 1);
        entries.push({ text, selection: after, selectionBefore: selectionBefore ?? entries[index].selection });
        if (entries.length > limit) entries.shift();
        index = entries.length - 1;
      }
      lastKind = kind;
      lastTime = now;
      return true;
    },
    /** Force the next typing to start a new undo group (e.g. after moving the caret). */
    breakGroup() {
      lastKind = null;
    },
    undo() {
      if (index === 0) return null;
      const undone = entries[index];
      index -= 1;
      lastKind = null;
      return { text: entries[index].text, selection: undone.selectionBefore ?? entries[index].selection };
    },
    redo() {
      if (index >= entries.length - 1) return null;
      index += 1;
      lastKind = null;
      return { text: entries[index].text, selection: entries[index].selection };
    },
    reset(text = '') {
      entries = [{ text, selection: { start: 0, end: 0 }, selectionBefore: { start: 0, end: 0 } }];
      index = 0;
      lastKind = null;
    },
  };
}
