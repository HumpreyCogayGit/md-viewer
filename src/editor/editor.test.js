import { describe, expect, it } from 'vitest';
import { createHistory } from './history.js';
import {
  documentStats,
  findInSource,
  findMatches,
  indentSelection,
  insertBlock,
  isSupportedFileName,
  offsetOfLine,
  outdentSelection,
  prefixLines,
  replaceAll,
  replaceMatch,
  toggleWrap,
} from './textEditing.js';
import { findShortcut, formatShortcut, matchShortcut } from './shortcuts.js';
import {
  DEFAULT_PREFS,
  initialTheme,
  loadDocuments,
  loadPrefs,
  pushRecent,
  readJson,
  saveDocuments,
  savePrefs,
  writeJson,
  KEYS,
} from './storage.js';
import { lineAtOffset, lineForPreviewOffset, offsetOfLineIndex, previewOffsetForLine } from './scrollSync.js';
import { applyResult, describeTarget, resolveTarget } from './targeting.js';
import { defaultRegistry } from '../operations/catalog.js';

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map };
};

describe('history (regression: per-keystroke entries and caret jumping)', () => {
  it('groups rapid typing into one undo step', () => {
    const history = createHistory('');
    history.record('a', {
      kind: 'typing',
      now: 0,
      selectionBefore: { start: 0, end: 0 },
      selectionAfter: { start: 1, end: 1 },
    });
    history.record('ab', { kind: 'typing', now: 100, selectionAfter: { start: 2, end: 2 } });
    history.record('abc', { kind: 'typing', now: 200, selectionAfter: { start: 3, end: 3 } });
    expect(history.size).toBe(2);
    expect(history.undo()).toEqual({ text: '', selection: { start: 0, end: 0 } });
  });

  it('starts a new group after a pause or a non-typing edit', () => {
    const history = createHistory('');
    history.record('a', { kind: 'typing', now: 0 });
    history.record('ab', { kind: 'typing', now: 5000 });
    history.record('AB', { kind: 'operation', now: 5100 });
    expect(history.size).toBe(4);
  });

  it('restores the caret on undo and redo instead of jumping to the end', () => {
    const history = createHistory('hello world');
    history.record('hello brave world', {
      kind: 'operation',
      selectionBefore: { start: 6, end: 6 },
      selectionAfter: { start: 12, end: 12 },
    });
    expect(history.undo()).toEqual({ text: 'hello world', selection: { start: 6, end: 6 } });
    expect(history.redo()).toEqual({ text: 'hello brave world', selection: { start: 12, end: 12 } });
    expect(history.redo()).toBeNull();
  });

  it('truncates redo history on a new edit, caps its size, and resets', () => {
    const history = createHistory('0', { limit: 3 });
    ['1', '2', '3', '4'].forEach((text) => history.record(text));
    expect(history.size).toBe(3);
    history.undo();
    history.record('x');
    expect(history.canRedo).toBe(false);
    history.reset('new');
    expect(history.canUndo).toBe(false);
    expect(history.current.text).toBe('new');
  });

  it('ignores records that do not change the text', () => {
    const history = createHistory('a');
    expect(history.record('a')).toBe(false);
    expect(history.size).toBe(1);
  });
});

describe('indentation (regression: Tab replaced multi-line selections)', () => {
  it('inserts an indent at the caret', () => {
    expect(indentSelection('ab', 1, 1)).toEqual({ text: 'a  b', start: 3, end: 3 });
  });

  it('indents every touched line and keeps the selection', () => {
    expect(indentSelection('a\nb\n\nc', 0, 6)).toEqual({ text: '  a\n  b\n\n  c', start: 2, end: 12 });
    expect(indentSelection('a\nb', 0, 3, { unit: '\t' }).text).toBe('\ta\n\tb');
  });

  it('outdents with Shift+Tab', () => {
    expect(outdentSelection('    a\n  b\nc', 0, 11)).toEqual({ text: '  a\nb\nc', start: 0, end: 7 });
    expect(outdentSelection('\ta', 1, 1)).toEqual({ text: 'a', start: 0, end: 0 });
  });

  it('does not include a line when the selection ends at its first column', () => {
    expect(indentSelection('a\nb\nc', 0, 4).text).toBe('  a\n  b\nc');
  });
});

describe('formatting helpers', () => {
  it('toggles bold on and off', () => {
    expect(toggleWrap('a word', 2, 6, '**')).toEqual({ text: 'a **word**', start: 4, end: 8 });
    expect(toggleWrap('a **word**', 4, 8, '**')).toEqual({ text: 'a word', start: 2, end: 6 });
    expect(toggleWrap('a **word**', 2, 10, '**')).toEqual({ text: 'a word', start: 2, end: 6 });
    expect(toggleWrap('', 0, 0, '*', '*', 'italic')).toEqual({ text: '*italic*', start: 1, end: 7 });
    expect(toggleWrap('a\nb', 0, 3, '**').text).toBe('**a**\n**b**');
  });

  it('prefixes lines and replaces existing heading markers', () => {
    expect(prefixLines('## Old', 0, 6, '# ').text).toBe('# Old');
    expect(prefixLines('a\nb', 0, 3, '> ').text).toBe('> a\n> b');
    expect(prefixLines('', 0, 0, '# ', 'Heading')).toEqual({ text: '# Heading', start: 2, end: 9 });
  });

  it('inserts blocks on their own line', () => {
    expect(insertBlock('text', 4, '---')).toEqual({ text: 'text\n---\n', start: 9, end: 9 });
    expect(insertBlock('', 0, '---').text).toBe('---\n');
  });
});

describe('files and statistics', () => {
  it('accepts upper-case and alternative Markdown extensions (regression)', () => {
    for (const name of ['a.md', 'B.MD', 'c.markdown', 'd.txt', 'e.Mdx']) expect(isSupportedFileName(name)).toBe(true);
    for (const name of ['a.pdf', 'md', 'x.md.exe']) expect(isSupportedFileName(name)).toBe(false);
  });

  it('computes status bar statistics', () => {
    const stats = documentStats('# Title\n\nHello world', 9, 14);
    expect(stats).toMatchObject({
      characters: 20,
      words: 3,
      lines: 3,
      selectionCharacters: 5,
      selectionWords: 1,
      cursorLine: 3,
      cursorColumn: 1,
      readingMinutes: 1,
    });
    expect(offsetOfLine('a\nbb\nccc', 3)).toBe(5);
    expect(offsetOfLine('a', 9)).toBe(1);
  });
});

describe('preview → source mapping (regression: first occurrence was edited)', () => {
  const markdown = 'Intro **repeat** text.\n\nSecond paragraph has repeat too.\n\nThird repeat.';

  it('uses the block range of the preview selection', () => {
    const range = { start: markdown.indexOf('Second'), end: markdown.indexOf('too.') + 4 };
    const result = findInSource(markdown, 'repeat', { range });
    expect(result.start).toBe(markdown.indexOf('repeat too'));
  });

  it('uses the occurrence index when the same text repeats', () => {
    expect(findInSource(markdown, 'repeat', { occurrence: 2 }).start).toBe(markdown.lastIndexOf('repeat'));
  });

  it('maps rendered text across inline markup', () => {
    const result = findInSource(markdown, 'Intro repeat text.');
    expect(markdown.slice(result.start, result.end)).toBe('Intro **repeat** text.');
    expect(findInSource(markdown, '')).toBeNull();
    expect(findInSource(markdown, 'absent words')).toBeNull();
  });

  it('maps multi-line preview selections', () => {
    const result = findInSource('# Title\n\n- one\n- two', 'Title\none\ntwo');
    expect(result).toEqual({ start: 0, end: 20 });
  });
});

describe('find and replace', () => {
  it('finds literal and regex matches', () => {
    expect(findMatches('a.b.c', '.').matches).toHaveLength(2);
    expect(findMatches('a1b22', '\\d+', { regex: true }).matches).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(findMatches('Cat cat', 'cat', { caseSensitive: true }).matches).toHaveLength(1);
    expect(findMatches('cat concat', 'cat', { wholeWord: true }).matches).toHaveLength(1);
    expect(findMatches('x', '(', { regex: true }).error).toBeTruthy();
    expect(findMatches('x', '').matches).toEqual([]);
  });

  it('replaces one match or all, with regex groups', () => {
    const { matches, pattern } = findMatches('John Smith', '(\\w+) (\\w+)', { regex: true });
    expect(replaceMatch('John Smith', matches[0], '$2 $1', { regex: true, pattern }).text).toBe('Smith John');
    expect(replaceAll('a-b-c', '-', '+')).toEqual({ text: 'a+b+c', count: 2 });
    expect(replaceAll('a1 b2', '(\\w)(\\d)', '$2$1', { regex: true })).toEqual({ text: '1a 2b', count: 2 });
    expect(() => replaceAll('x', '(', 'y', { regex: true })).toThrow();
  });
});

describe('shortcuts', () => {
  it('formats platform-aware labels', () => {
    expect(formatShortcut('Mod+Shift+P', true)).toBe('⌘⇧P');
    expect(formatShortcut('Mod+Shift+P', false)).toBe('Ctrl+Shift+P');
  });

  it('matches events, including Alt-modified keys by physical code', () => {
    expect(matchShortcut({ key: 'b', metaKey: true }, 'Mod+B', true)).toBe(true);
    expect(matchShortcut({ key: 'b', ctrlKey: true }, 'Mod+B', true)).toBe(false);
    expect(matchShortcut({ key: 'P', ctrlKey: true, shiftKey: true }, 'Mod+Shift+P', false)).toBe(true);
    expect(matchShortcut({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true }, 'Mod+Alt+F', true)).toBe(true);
    expect(findShortcut({ key: 'o', metaKey: true }, true).id).toBe('open');
    expect(findShortcut({ key: 's', metaKey: true }, true).id).toBe('save');
    expect(findShortcut({ key: 'i', ctrlKey: true }, false).id).toBe('italic');
    expect(findShortcut({ key: 'x' }, false)).toBeNull();
  });
});

describe('storage', () => {
  it('reads and writes JSON safely', () => {
    const storage = memoryStorage();
    expect(writeJson('k', { a: 1 }, storage)).toBe(true);
    expect(readJson('k', null, storage)).toEqual({ a: 1 });
    storage.setItem('bad', '{');
    expect(readJson('bad', 'fallback', storage)).toBe('fallback');
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readJson('k', 7, throwing)).toBe(7);
    expect(writeJson('k', 1, throwing)).toBe(false);
  });

  it('persists and sanitizes preferences', () => {
    const storage = memoryStorage();
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
    savePrefs({ ...DEFAULT_PREFS, theme: 'dark', dividerPosition: 500, focusMode: 'bogus' }, storage);
    expect(loadPrefs(storage)).toMatchObject({ theme: 'dark', dividerPosition: 90, focusMode: 'none' });
  });

  it('follows prefers-color-scheme until a theme is chosen', () => {
    const dark = () => ({ matches: true });
    expect(initialTheme({ theme: null }, dark)).toBe('dark');
    expect(initialTheme({ theme: 'light' }, dark)).toBe('light');
    expect(initialTheme({ theme: null }, undefined)).toBe('light');
  });

  it('autosaves and restores documents (and migrates the legacy single document)', () => {
    const storage = memoryStorage();
    expect(loadDocuments(storage)).toBeNull();
    writeJson(KEYS.legacyDocument, { content: 'old', fileName: 'a.md' }, storage);
    expect(loadDocuments(storage).documents[0]).toMatchObject({ content: 'old', fileName: 'a.md' });
    saveDocuments(
      [
        { id: 'x', fileName: 'x.md', content: 'X', dirty: true },
        { id: 'y', fileName: 'y.md', content: 'Y' },
      ],
      'y',
      storage,
    );
    expect(loadDocuments(storage)).toMatchObject({
      activeId: 'y',
      documents: [
        { id: 'x', content: 'X', dirty: true },
        { id: 'y', content: 'Y', dirty: false },
      ],
    });
  });

  it('keeps recent lists unique and bounded', () => {
    const storage = memoryStorage();
    pushRecent('r', 'a', { storage });
    pushRecent('r', 'b', { storage });
    expect(pushRecent('r', 'a', { storage, limit: 2 })).toEqual(['a', 'b']);
  });
});

describe('line-based scroll sync', () => {
  const lineTops = [0, 20, 40, 100, 120];

  it('maps editor offsets to fractional lines and back', () => {
    expect(lineAtOffset(lineTops, 30)).toBe(1.5);
    expect(lineAtOffset(lineTops, 70)).toBe(2.5);
    expect(lineAtOffset(lineTops, 500)).toBe(4);
    expect(lineAtOffset([], 10)).toBe(0);
    expect(offsetOfLineIndex(lineTops, 2.5)).toBe(70);
  });

  it('interpolates between preview anchors in both directions', () => {
    const anchors = [
      { line: 0, top: 0 },
      { line: 10, top: 300 },
      { line: 20, top: 400 },
    ];
    expect(previewOffsetForLine(anchors, 5)).toBe(150);
    expect(previewOffsetForLine(anchors, 15)).toBe(350);
    expect(previewOffsetForLine(anchors, 25)).toBe(400);
    expect(lineForPreviewOffset(anchors, 350)).toBe(15);
    expect(lineForPreviewOffset(anchors, 1000)).toBe(20);
    expect(lineForPreviewOffset([], 5)).toBe(0);
  });
});

describe('operation targeting', () => {
  const upper = defaultRegistry.get('case.upper');
  const beautify = defaultRegistry.get('format.json-beautify');
  const uuid = defaultRegistry.get('generate.uuid');
  const toc = defaultRegistry.get('md.toc');
  const text = 'intro\n```json\n{"a":1}\n```\nend';

  it('prefers the editor selection, then preview selection', () => {
    expect(resolveTarget({ operation: upper, text, selectionStart: 0, selectionEnd: 5 })).toEqual({
      kind: 'selection',
      start: 0,
      end: 5,
    });
    expect(
      resolveTarget({ operation: upper, text, selectionStart: 0, selectionEnd: 0, previewRange: { start: 1, end: 3 } })
        .kind,
    ).toBe('preview');
  });

  it('uses the fenced block around the caret', () => {
    const caret = text.indexOf('"a"');
    expect(resolveTarget({ operation: beautify, text, selectionStart: caret, selectionEnd: caret })).toMatchObject({
      kind: 'block',
      start: 6,
      end: 25,
    });
    const content = resolveTarget({ operation: upper, text, selectionStart: caret, selectionEnd: caret });
    expect(text.slice(content.start, content.end)).toBe('{"a":1}');
  });

  it('runs generators at the caret and document operations on the whole document', () => {
    expect(resolveTarget({ operation: uuid, text, selectionStart: 2, selectionEnd: 2 })).toEqual({
      kind: 'cursor',
      start: 2,
      end: 2,
    });
    expect(resolveTarget({ operation: toc, text, selectionStart: 3, selectionEnd: 3 })).toMatchObject({
      kind: 'document',
      start: 0,
      end: text.length,
    });
  });

  it('asks before running on the entire document (regression: "undefined" message)', () => {
    expect(resolveTarget({ operation: upper, text: 'abc', selectionStart: 1, selectionEnd: 1 })).toEqual({
      kind: 'confirm-document',
    });
    expect(
      resolveTarget({ operation: upper, text: 'abc', selectionStart: 1, selectionEnd: 1, documentConfirmed: true })
        .kind,
    ).toBe('document');
    expect(resolveTarget({ operation: upper, text: '  ', selectionStart: 0, selectionEnd: 0 })).toEqual({
      kind: 'empty',
    });
    expect(describeTarget({ kind: 'block' })).toBe('the current code block');
  });

  it('applies replace and insert results', () => {
    expect(applyResult('a b c', { kind: 'selection', start: 2, end: 3 }, 'X')).toEqual({
      text: 'a X c',
      start: 2,
      end: 3,
    });
    expect(applyResult('ab', { kind: 'cursor', start: 1, end: 1 }, 'X', 'insert')).toEqual({
      text: 'aXb',
      start: 1,
      end: 2,
    });
    expect(applyResult('line one\nline two', { kind: 'selection', start: 0, end: 4 }, 'REPORT', 'insert').text).toBe(
      'line one\n\nREPORT\n\nline two',
    );
    expect(applyResult('para\n', { kind: 'selection', start: 0, end: 5 }, 'R', 'insert').text).toBe('para\n\nR\n');
    expect(applyResult('ab', { kind: 'cursor', start: 1, end: 1 }, 'x\ny', 'insert').text).toBe('a\nx\ny\nb');
  });
});
