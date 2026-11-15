# Evaluation: replacing the `<textarea>` with CodeMirror 6

Date: 2026-11-15. Status: **evaluated, not adopted for this release.**

## What CodeMirror 6 would provide

Grouped undo, indent/outdent, search, multi-cursor, line numbers, syntax highlighting in the editor, and precise
position ↔ pixel mapping for scroll sync.

## What Speculo now has without it

| Need | Current implementation |
| --- | --- |
| Grouped undo with caret restore | `src/editor/history.js` (time-grouped typing, selection before/after) |
| Tab / Shift+Tab, Escape to leave | `indentSelection` / `outdentSelection` in `src/editor/textEditing.js` |
| Find and replace (literal/regex) | `FindReplaceBar` + `findMatches` / `replaceAll` |
| Line numbers with soft wrap | `EditorPane` measures line tops with a hidden mirror element |
| Line-based scroll sync | `src/editor/scrollSync.js` + `data-sl` source positions on rendered blocks |

## Reasons for deferring

- **Bundle budget:** CodeMirror with the Markdown language and search adds roughly 120–150 KB gzip to the initial
  load; the budget is 450 KB and the current initial JavaScript is about 307 KB.
- **Integration surface:** the preview-selection mapping, toolbar actions, operation targeting and the e2e tests all
  use `selectionStart`/`selectionEnd` and textarea events. Switching editors means rewriting those paths at once.
- **Accessibility:** the native textarea already works with screen readers, spell checking, IME input and mobile
  keyboards without extra configuration.

## When to revisit

Adopt CodeMirror (lazy-loaded, with the textarea as fallback) if any of these become requirements: multi-cursor
editing, editor-side syntax highlighting, very large documents (>20,000 lines, where mirror measurement falls back to
uniform line heights), or collaborative editing.
