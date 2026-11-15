import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defaultRegistry } from '../operations/catalog.js';
import { executeOperationDetailed } from '../operations/selection.js';
import { runSmart } from '../operations/workerClient.js';
import { suggestOperations } from '../operations/suggestions.js';
import { recipeFromFragment } from '../operations/recipes.js';
import { looksLikeCsv } from '../operations/structuredData/formats.js';
import { csvToMarkdownTable } from '../operations/structuredData/formats.js';
import { createHistory } from '../editor/history.js';
import {
  FILE_ACCEPT,
  documentStats,
  findInSource,
  indentSelection,
  insertBlock,
  isSupportedFileName,
  offsetOfLine,
  outdentSelection,
  prefixLines,
  toggleWrap,
} from '../editor/textEditing.js';
import { findShortcut, isMacPlatform, shortcutLabel as labelFor } from '../editor/shortcuts.js';
import {
  KEYS,
  initialTheme,
  loadDocuments,
  loadPrefs,
  pushRecent,
  readJson,
  saveDocuments,
  savePrefs,
} from '../editor/storage.js';
import {
  collectAnchors,
  lineAtOffset,
  lineForPreviewOffset,
  offsetOfLineIndex,
  previewOffsetForLine,
} from '../editor/scrollSync.js';
import { applyResult, describeTarget, resolveTarget } from '../editor/targeting.js';
import {
  downloadText,
  openWithPicker,
  readFile,
  readFileAsDataUrl,
  recallHandle,
  rememberHandle,
  reopenHandle,
  saveDocument,
  supportsFileSystemAccess,
} from '../export/files.js';
import { sourceRangeForSelection } from '../preview/rehypeSourcePositions.js';
import { disableAnalytics, enableAnalytics, getConsent, setConsent } from '../privacy/analytics.js';
import { AppMenu } from '../components/AppMenu.jsx';
import { ConfirmDialog } from '../components/Dialog.jsx';
import { EditorPane } from '../components/EditorPane.jsx';
import { FindReplaceBar } from '../components/FindReplaceBar.jsx';
import { FormatToolbar } from '../components/FormatToolbar.jsx';
import { MarkdownPreview } from '../components/MarkdownPreview.jsx';
import { OperationPalette, needsInput } from '../components/OperationPalette.jsx';
import { ContextMenu } from '../components/ContextMenu.jsx';
import { buildToolMenu } from '../editor/toolMenu.js';
import { ConsentBanner, OutlinePanel, ShortcutsDialog, StatusBar, TabBar } from '../components/Panels.jsx';
import { PreviewDialog } from '../components/PreviewDialog.jsx';
import { ResultPanel } from '../components/ResultPanel.jsx';
import { StatusToast, useStatus } from '../components/StatusToast.jsx';
import { Workbench } from '../components/Workbench.jsx';
import { WELCOME_DOCUMENT } from './welcomeDocument.js';
import '../App.css';

const registry = defaultRegistry;
const LARGE_DOCUMENT = 150_000;
let documentCounter = 0;
const newDocument = (content = '', fileName = 'untitled.md') => ({
  id: `doc-${Date.now().toString(36)}-${(documentCounter += 1)}`,
  fileName,
  content,
  dirty: false,
});

function useDebouncedValue(value, delay, enabled) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (!enabled) {
      setDebounced(value);
      return undefined;
    }
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, enabled]);
  return enabled ? debounced : value;
}

export default function App() {
  const mac = useMemo(() => isMacPlatform(), []);
  const shortcutLabel = useCallback((id) => labelFor(id, mac), [mac]);
  const { status, show: notify, clear: clearStatus } = useStatus();

  // ------------------------------------------------------------------ Preferences
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [theme, setTheme] = useState(() => initialTheme(loadPrefs()));
  const updatePrefs = useCallback((patch) => setPrefs((current) => ({ ...current, ...patch })), []);
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#1e1e24' : '#ffffff');
  }, [theme]);
  useEffect(() => {
    if (prefs.theme) return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = (event) => setTheme(event.matches ? 'dark' : 'light');
    media?.addEventListener?.('change', onChange);
    return () => media?.removeEventListener?.('change', onChange);
  }, [prefs.theme]);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    updatePrefs({ theme: next });
  };

  // ------------------------------------------------------------------ Documents (tabs) and autosave
  const [docState, setDocState] = useState(() => {
    const restored = loadDocuments();
    if (restored) return restored;
    const welcome = { ...newDocument(WELCOME_DOCUMENT, 'document.md') };
    return { documents: [welcome], activeId: welcome.id };
  });
  const { documents, activeId } = docState;
  const activeDoc = documents.find((doc) => doc.id === activeId) || documents[0];
  const content = activeDoc.content;
  const fileName = activeDoc.fileName;

  const historiesRef = useRef(new Map());
  const handlesRef = useRef(new Map());
  const historyFor = useCallback((doc) => {
    if (!historiesRef.current.has(doc.id)) historiesRef.current.set(doc.id, createHistory(doc.content));
    return historiesRef.current.get(doc.id);
  }, []);
  const history = historyFor(activeDoc);

  const [restoredNotice] = useState(() => Boolean(loadDocuments()));
  useEffect(() => {
    if (restoredNotice) notify('Restored your documents from this browser.', 'info');
  }, [restoredNotice, notify]);

  useEffect(() => {
    const timer = setTimeout(() => saveDocuments(documents, activeId), 400);
    return () => clearTimeout(timer);
  }, [documents, activeId]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      saveDocuments(documents, activeId);
      if (documents.some((doc) => doc.dirty)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [documents, activeId]);

  const setActiveDocFields = useCallback(
    (patch) =>
      setDocState((state) => ({
        ...state,
        documents: state.documents.map((doc) => (doc.id === state.activeId ? { ...doc, ...patch } : doc)),
      })),
    [],
  );

  // ------------------------------------------------------------------ Editor state
  const textareaRef = useRef(null);
  const previewRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const pendingSelectionRef = useRef(null);
  const lastPaneRef = useRef('editor');
  const escapeArmedRef = useRef(false);
  const lineTopsRef = useRef([]);
  const anchorsRef = useRef([]);
  const syncingRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  const updateContent = useCallback(
    (text, { selectionBefore = selectionRef.current, selectionAfter, kind = 'edit' } = {}) => {
      history.record(text, { selectionBefore, selectionAfter, kind });
      setActiveDocFields({ content: text, dirty: true });
      if (selectionAfter) pendingSelectionRef.current = selectionAfter;
    },
    [history, setActiveDocFields],
  );

  // Runs after every render on purpose: applies a selection queued by an edit. It clears the queue before
  // updating state, so it cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const pending = pendingSelectionRef.current;
    if (!textarea || !pending) return;
    pendingSelectionRef.current = null;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(pending.start, pending.end);
    selectionRef.current = pending;
    setSelection(pending);
  });

  const readSelection = () => {
    const textarea = textareaRef.current;
    return textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : selectionRef.current;
  };

  const onEditorSelect = () => {
    const current = readSelection();
    if (current.start !== selectionRef.current.start || current.end !== selectionRef.current.end) history.breakGroup();
    selectionRef.current = current;
    setSelection(current);
  };

  const handleChange = (event) => {
    const after = { start: event.target.selectionStart, end: event.target.selectionEnd };
    history.record(event.target.value, {
      selectionBefore: selectionRef.current,
      selectionAfter: after,
      kind: 'typing',
    });
    selectionRef.current = after;
    setSelection(after);
    setActiveDocFields({ content: event.target.value, dirty: true });
  };

  const undo = useCallback(() => {
    const state = history.undo();
    if (!state) return;
    setActiveDocFields({ content: state.text, dirty: true });
    pendingSelectionRef.current = state.selection;
  }, [history, setActiveDocFields]);

  const redo = useCallback(() => {
    const state = history.redo();
    if (!state) return;
    setActiveDocFields({ content: state.text, dirty: true });
    pendingSelectionRef.current = state.selection;
  }, [history, setActiveDocFields]);

  // ------------------------------------------------------------------ Formatting actions
  const applyEdit = useCallback(
    (fn) => {
      const { start, end } = readSelection();
      const result = fn(content, start, end);
      updateContent(result.text, {
        selectionBefore: { start, end },
        selectionAfter: { start: result.start, end: result.end },
      });
    },
    [content, updateContent],
  );

  const mapPreviewSelection = useCallback(() => {
    if (lastPaneRef.current !== 'preview') return null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !previewRef.current?.contains(sel.anchorNode)) return null;
    const hint = sourceRangeForSelection(sel, previewRef.current);
    return findInSource(content, sel.toString(), hint ? { range: hint, occurrence: hint.occurrence } : {});
  }, [content]);

  const formatAction = useCallback(
    (id) => {
      if (id === 'palette') {
        setPaletteOpen(true);
        return;
      }
      // Toolbar actions on a preview selection operate on the mapped source text.
      const mapped = mapPreviewSelection();
      if (mapped && textareaRef.current) {
        textareaRef.current.setSelectionRange(mapped.start, mapped.end);
        selectionRef.current = mapped;
        window.getSelection()?.removeAllRanges();
      }
      const wrap = (before, after, placeholder) =>
        applyEdit((text, s, e) => toggleWrap(text, s, e, before, after, placeholder));
      const block = (markdown) => applyEdit((text, s) => insertBlock(text, s, markdown));
      const actions = {
        bold: () => wrap('**', '**', 'bold'),
        italic: () => wrap('*', '*', 'italic'),
        strike: () => wrap('~~', '~~', 'strikethrough'),
        code: () => wrap('`', '`', 'code'),
        h1: () => applyEdit((text, s, e) => prefixLines(text, s, e, '# ', 'Heading 1')),
        h2: () => applyEdit((text, s, e) => prefixLines(text, s, e, '## ', 'Heading 2')),
        h3: () => applyEdit((text, s, e) => prefixLines(text, s, e, '### ', 'Heading 3')),
        quote: () => applyEdit((text, s, e) => prefixLines(text, s, e, '> ', 'quote')),
        ul: () =>
          applyEdit((text, s, e) => (e > s ? prefixLines(text, s, e, '- ') : insertBlock(text, s, '- List item'))),
        ol: () =>
          applyEdit((text, s, e) => (e > s ? prefixLines(text, s, e, '1. ') : insertBlock(text, s, '1. List item'))),
        task: () =>
          applyEdit((text, s, e) =>
            e > s ? prefixLines(text, s, e, '- [ ] ') : insertBlock(text, s, '- [ ] Task item'),
          ),
        link: () => wrap('[', '](url)', 'link text'),
        image: () => wrap('![', '](url)', 'alt text'),
        table: () => block('| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |'),
        codeblock: () => block('```\ncode here\n```'),
        hr: () => block('---'),
        math: () => wrap('$', '$', 'E = mc^2'),
        mathblock: () => block('$$\nx^2 + y^2 = z^2\n$$'),
        mermaid: () => block('```mermaid\ngraph TD\n    A[Start] --> B[End]\n```'),
      };
      actions[id]?.();
    },
    [applyEdit, mapPreviewSelection],
  );

  // ------------------------------------------------------------------ Operations
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteOperationId, setPaletteOperationId] = useState(null);
  const [toolMenu, setToolMenu] = useState(null);
  const [paletteSuggestions, setPaletteSuggestions] = useState([]);
  const [result, setResult] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const runningRef = useRef(null);

  const askConfirm = useCallback((options) => new Promise((resolve) => setConfirm({ ...options, resolve })), []);
  const closeConfirm = (value) => {
    confirm?.resolve(value);
    setConfirm(null);
  };

  const openPalette = useCallback(() => {
    const { start, end } = readSelection();
    const text = end > start ? content.slice(start, end) : window.getSelection()?.toString() || '';
    setPaletteSuggestions(suggestOperations(text, { registry }));
    setPaletteOperationId(null);
    setPaletteOpen(true);
  }, [content]);

  const runOperationById = useCallback(
    async (operationId, options = {}, { preview = false, documentConfirmed = false } = {}) => {
      setPaletteOpen(false);
      const operation = registry.get(operationId);
      const { start, end } = readSelection();
      const previewRange = mapPreviewSelection();
      const target = resolveTarget({
        operation,
        text: content,
        selectionStart: start,
        selectionEnd: end,
        previewRange,
        documentConfirmed,
      });
      if (target.kind === 'empty') {
        notify('The document is empty. Type or paste some text first.', 'error');
        return;
      }
      if (target.kind === 'confirm-document') {
        const ok = await askConfirm({
          title: `Run “${operation.name}” on the whole document?`,
          message: 'Nothing is selected and the cursor is not in a code block. You can undo the change afterwards.',
          confirmLabel: 'Apply to whole document',
        });
        if (ok) runOperationById(operationId, options, { preview, documentConfirmed: true });
        return;
      }
      const input = target.kind === 'cursor' ? '' : content.slice(target.start, target.end);
      runningRef.current?.abort();
      const controller = new AbortController();
      runningRef.current = controller;
      const slow = setTimeout(() => notify(`Running ${operation.name}…`, 'info', 0), 400);
      try {
        const { text: output, warnings } = await executeOperationDetailed(operation, input, options, {
          signal: controller.signal,
          runner: (op, value, opts, ctx) => runSmart(op, value, opts, ctx),
        });
        clearTimeout(slow);
        if (controller.signal.aborted) return;
        if (operation.outputMode === 'report') {
          setResult({ title: operation.name, output, warnings, notes: operation.notes, target });
          clearStatus();
          return;
        }
        const mode = operation.outputMode === 'insert' ? 'insert' : 'replace';
        if (preview || operation.potentiallyLossy || prefs.previewBeforeApply) {
          setPendingPreview({ operation, input, output, warnings, target, mode });
          clearStatus();
          return;
        }
        const applied = applyResult(content, target, output, mode);
        updateContent(applied.text, {
          selectionBefore: { start, end },
          selectionAfter: { start: applied.start, end: applied.end },
          kind: 'operation',
        });
        window.getSelection()?.removeAllRanges();
        notify(
          warnings.length
            ? `${operation.name}: ${warnings.join(' ')}`
            : `${operation.name} applied to ${describeTarget(target)}.`,
          warnings.length ? 'warning' : 'success',
          warnings.length ? 8000 : undefined,
        );
      } catch (error) {
        clearTimeout(slow);
        if (!controller.signal.aborted) notify(error.message || `${operation.name} failed.`, 'error');
      } finally {
        if (runningRef.current === controller) runningRef.current = null;
      }
    },
    [content, mapPreviewSelection, askConfirm, notify, clearStatus, prefs.previewBeforeApply, updateContent],
  );

  const applyPending = (mode) => {
    if (!pendingPreview) return;
    const { operation, output, target } = pendingPreview;
    const before = readSelection();
    const applied = applyResult(content, target, output, mode === 'insert' ? 'insert' : pendingPreview.mode);
    updateContent(applied.text, {
      selectionBefore: before,
      selectionAfter: { start: applied.start, end: applied.end },
      kind: 'operation',
    });
    setPendingPreview(null);
    notify(`${operation.name} applied.`);
  };

  const copyText = async (text, message = 'Copied to clipboard.') => {
    try {
      await navigator.clipboard.writeText(text);
      notify(message);
    } catch {
      notify('Could not access the clipboard.', 'error');
    }
  };

  const insertAtCursor = (text) => {
    const { start, end } = readSelection();
    const applied = applyResult(content, { kind: 'cursor', start: end, end }, text, 'insert');
    updateContent(applied.text, {
      selectionBefore: { start, end },
      selectionAfter: { start: applied.start, end: applied.end },
      kind: 'operation',
    });
  };

  // ------------------------------------------------------------------ Right-click tools menu
  const openToolMenu = useCallback(
    (pane, x, y) => {
      const { start, end } = readSelection();
      const selectionText = pane === 'editor' ? content.slice(start, end) : window.getSelection()?.toString() || '';
      lastPaneRef.current = pane;
      setToolMenu({ pane, x, y, selectionText });
    },
    [content],
  );

  const onPaneContextMenu = (pane) => (event) => {
    // Shift+right-click keeps the browser's own menu (spelling suggestions, inspect, …).
    if (event.shiftKey) return;
    event.preventDefault();
    openToolMenu(pane, event.clientX, event.clientY);
  };

  const isMenuKey = (event) => event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');

  const openToolMenuFromKeyboard = (pane) => {
    if (pane === 'editor' && textareaRef.current) {
      const textarea = textareaRef.current;
      const rect = textarea.getBoundingClientRect();
      const line = content.slice(0, textarea.selectionStart).split('\n').length;
      const top = (lineTopsRef.current[line - 1] ?? 0) - textarea.scrollTop + rect.top + 24;
      openToolMenu(pane, rect.left + 72, Math.min(Math.max(top, rect.top + 8), rect.bottom - 8));
      return;
    }
    const rect = previewRef.current?.getBoundingClientRect();
    openToolMenu(pane, (rect?.left ?? 0) + 40, (rect?.top ?? 0) + 40);
  };

  const closeToolMenu = useCallback(() => setToolMenu(null), []);

  const toolMenuEntries = useMemo(
    () =>
      toolMenu
        ? buildToolMenu(registry, {
            selectionText: toolMenu.selectionText,
            recents: readJson(KEYS.paletteRecents, []),
            pane: toolMenu.pane,
            canPaste: Boolean(navigator.clipboard?.readText),
            shortcuts: { palette: shortcutLabel('palette'), workbench: shortcutLabel('workbench') },
          })
        : [],
    [toolMenu, shortcutLabel],
  );

  const onToolMenuSelect = async (entry) => {
    const menu = toolMenu;
    if (entry.operationId) {
      const operation = registry.get(entry.operationId);
      pushRecent(KEYS.paletteRecents, operation.id, { limit: 12 });
      if (needsInput(operation)) {
        setPaletteOperationId(operation.id);
        setPaletteOpen(true);
      } else {
        runOperationById(operation.id, {}, {});
      }
      return;
    }
    const { start, end } = readSelection();
    const selected = menu?.selectionText || '';
    switch (entry.action) {
      case 'palette':
        openPalette();
        break;
      case 'workbench':
        setWorkbench({ input: selected, recipe: undefined });
        break;
      case 'copy':
        copyText(selected, 'Copied.');
        break;
      case 'cut':
        await copyText(selected, 'Cut.');
        updateContent(content.slice(0, start) + content.slice(end), {
          selectionBefore: { start, end },
          selectionAfter: { start, end: start },
        });
        break;
      case 'paste':
        try {
          const text = await navigator.clipboard.readText();
          const applied = applyResult(content, { kind: 'selection', start, end }, text, 'replace');
          updateContent(applied.text, {
            selectionBefore: { start, end },
            selectionAfter: { start: applied.end, end: applied.end },
          });
        } catch {
          notify(`The browser blocked clipboard access. Use ${mac ? '⌘' : 'Ctrl'}+V instead.`, 'error');
        }
        break;
      default:
    }
  };

  // ------------------------------------------------------------------ Files
  const [recentFiles, setRecentFiles] = useState(() => readJson(KEYS.recentFiles, []));

  const openDocument = useCallback(
    (name, text, handle = null) => {
      const doc = newDocument(text, name);
      const replaceCurrent = !activeDoc.dirty && activeDoc.content === WELCOME_DOCUMENT;
      historiesRef.current.set(doc.id, createHistory(text));
      if (handle) {
        handlesRef.current.set(doc.id, handle);
        const key = `${name}:${Date.now()}`;
        rememberHandle(key, handle).then(
          (ok) =>
            ok &&
            setRecentFiles(
              pushRecent(KEYS.recentFiles, { name, key }, { limit: 8, equals: (a, b) => a.name === b.name }),
            ),
        );
      }
      setDocState((state) => ({
        documents: replaceCurrent
          ? state.documents.map((d) => (d.id === state.activeId ? doc : d))
          : [...state.documents, doc],
        activeId: doc.id,
      }));
      pendingSelectionRef.current = { start: 0, end: 0 };
      notify(`Opened ${name}.`);
    },
    [activeDoc, notify],
  );

  const openFile = useCallback(async () => {
    if (supportsFileSystemAccess()) {
      try {
        const file = await openWithPicker();
        if (file) openDocument(file.name, file.content, file.handle);
      } catch (error) {
        notify(`Could not open the file: ${error.message}`, 'error');
      }
      return;
    }
    fileInputRef.current?.click();
  }, [openDocument, notify]);

  const loadFileObject = useCallback(
    async (file) => {
      if (!file) return;
      if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file);
        if (dataUrl.length > 2_000_000) notify('Large image embedded; the document will be big.', 'warning');
        insertAtCursor(`![${file.name.replace(/[[\]]/g, '')}](${dataUrl})`);
        return;
      }
      if (!isSupportedFileName(file.name)) {
        notify('Only Markdown or text files (.md, .markdown, .txt) can be opened.', 'error');
        return;
      }
      try {
        openDocument(file.name, await readFile(file));
      } catch (error) {
        notify(`Could not read ${file.name}: ${error.message}`, 'error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openDocument, notify, content],
  );

  const saveFile = useCallback(
    async (saveAs = false) => {
      try {
        const saved = await saveDocument(content, { fileName, handle: handlesRef.current.get(activeDoc.id), saveAs });
        if (!saved) return;
        if (saved.handle) handlesRef.current.set(activeDoc.id, saved.handle);
        setActiveDocFields({ dirty: false, fileName: saved.name || fileName });
        notify(saved.method === 'download' ? `Downloaded ${saved.name}.` : `Saved ${saved.name}.`);
      } catch (error) {
        notify(`Could not save: ${error.message}`, 'error');
      }
    },
    [content, fileName, activeDoc.id, setActiveDocFields, notify],
  );

  const reopenRecent = async (entry) => {
    const handle = await recallHandle(entry.key);
    if (!handle) {
      notify(`“${entry.name}” is no longer available. Open it again from disk.`, 'error');
      return;
    }
    try {
      const file = await reopenHandle(handle);
      openDocument(file.name, file.content, handle);
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const [isExporting, setIsExporting] = useState(false);
  const exportPdfFile = async () => {
    setIsExporting(true);
    notify('Preparing PDF…', 'info', 0);
    try {
      const { exportPdf } = await import('../export/pdf.js');
      await exportPdf(content, fileName, {
        confirmRemote: (urls) =>
          askConfirm({
            title: 'Download remote images for the PDF?',
            message: `The document references ${urls.length} remote image${urls.length === 1 ? '' : 's'} (e.g. ${new URL(urls[0], location.href).host}). Fetching them contacts those servers. Skip to export without them.`,
            confirmLabel: 'Download images',
            cancelLabel: 'Skip images',
          }),
      });
      notify('PDF exported.');
    } catch (error) {
      notify(`PDF export failed: ${error.message || error}`, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const exportHtmlFile = async () => {
    try {
      const { buildStandaloneHtml, collectPageCss, sanitizeHtml } = await import('../export/html.js');
      const body = await sanitizeHtml(previewRef.current?.innerHTML || '');
      downloadText(
        buildStandaloneHtml(body, { title: fileName.replace(/\.\w+$/, ''), css: collectPageCss(), theme }),
        fileName.replace(/\.\w+$/, '') + '.html',
        'text/html;charset=utf-8',
      );
      notify('Standalone HTML exported.');
    } catch (error) {
      notify(`HTML export failed: ${error.message}`, 'error');
    }
  };

  const copyRich = async () => {
    try {
      const { copyRichText, sanitizeHtml } = await import('../export/html.js');
      const kind = await copyRichText(
        await sanitizeHtml(previewRef.current?.innerHTML || ''),
        previewRef.current?.innerText || '',
      );
      notify(kind === 'rich' ? 'Copied as rich text.' : 'Copied as plain text (rich text not supported here).');
    } catch {
      notify('Could not access the clipboard.', 'error');
    }
  };

  // ------------------------------------------------------------------ Tabs
  const newTab = () => {
    const doc = newDocument('', `untitled-${documents.length + 1}.md`);
    setDocState((state) => ({ documents: [...state.documents, doc], activeId: doc.id }));
    pendingSelectionRef.current = { start: 0, end: 0 };
  };
  const selectTab = (id) => setDocState((state) => ({ ...state, activeId: id }));
  const closeTab = async (id) => {
    const doc = documents.find((d) => d.id === id);
    if (doc?.dirty && doc.content.trim()) {
      const ok = await askConfirm({
        title: `Close ${doc.fileName}?`,
        message: 'It has changes that were not saved to a file. Closing removes it from this browser.',
        confirmLabel: 'Close without saving',
        danger: true,
      });
      if (!ok) return;
    }
    historiesRef.current.delete(id);
    handlesRef.current.delete(id);
    setDocState((state) => {
      const remaining = state.documents.filter((d) => d.id !== id);
      return {
        documents: remaining,
        activeId:
          state.activeId === id
            ? remaining[Math.max(0, state.documents.findIndex((d) => d.id === id) - 1)].id
            : state.activeId,
      };
    });
  };

  // ------------------------------------------------------------------ Panels
  const [findMode, setFindMode] = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [workbench, setWorkbench] = useState(null);
  const [allowedImages, setAllowedImages] = useState(() => new Set());
  const [consent, setConsentState] = useState(() => getConsent());

  useEffect(() => {
    if (consent === 'granted') enableAnalytics();
    else disableAnalytics();
  }, [consent]);
  const decideConsent = (value) => {
    setConsent(value);
    setConsentState(value);
    notify(value === 'granted' ? 'Analytics enabled. Thank you!' : 'Analytics stay off.', 'info');
  };

  useEffect(() => {
    if (!window.location.hash.includes('recipe=')) return;
    try {
      const recipe = recipeFromFragment(window.location.hash, registry);
      if (recipe) {
        setWorkbench({ input: '', recipe });
        notify(`Loaded shared recipe “${recipe.name}”.`, 'info');
      }
    } catch (error) {
      notify(error.message, 'error');
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [notify]);

  const openWorkbench = () => {
    const { start, end } = readSelection();
    setWorkbench((current) => (current ? null : { input: content.slice(start, end), recipe: undefined }));
  };

  const jumpToLine = (line) => {
    const offset = offsetOfLine(content, line);
    pendingSelectionRef.current = { start: offset, end: offset };
    setSelection({ start: offset, end: offset });
    const textarea = textareaRef.current;
    if (textarea) textarea.scrollTop = Math.max(0, (lineTopsRef.current[line - 1] ?? 0) - 40);
    const anchor = previewRef.current?.querySelector(`[data-sl="${line}"]`);
    anchor?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  // ------------------------------------------------------------------ Keyboard
  const handleEditorKeyDown = (event) => {
    if (isMenuKey(event)) {
      event.preventDefault();
      openToolMenuFromKeyboard('editor');
      return;
    }
    if (event.key === 'Escape') {
      escapeArmedRef.current = true;
      if (findMode) setFindMode(null);
      return;
    }
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (escapeArmedRef.current) {
        escapeArmedRef.current = false;
        return; // Let focus leave the editor.
      }
      event.preventDefault();
      applyEdit((text, s, e) => (event.shiftKey ? outdentSelection(text, s, e) : indentSelection(text, s, e)));
      return;
    }
    escapeArmedRef.current = false;
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const shortcut = findShortcut(event, mac);
      if (!shortcut) return;
      const active = document.activeElement;
      const inEditor = active === textareaRef.current;
      const inOtherField =
        !inEditor &&
        active &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      const inDialog = Boolean(active?.closest?.('[role="dialog"]'));
      if (inDialog && shortcut.id !== 'palette') return;
      switch (shortcut.id) {
        case 'undo':
        case 'redo':
        case 'redoAlt':
          if (inOtherField) return;
          event.preventDefault();
          if (shortcut.id === 'undo') undo();
          else redo();
          return;
        case 'bold':
        case 'italic':
        case 'link':
        case 'code':
          if (inOtherField) return;
          event.preventDefault();
          formatAction(shortcut.id);
          return;
        case 'open':
          event.preventDefault();
          openFile();
          return;
        case 'save':
          event.preventDefault();
          saveFile(false);
          return;
        case 'saveAs':
          event.preventDefault();
          saveFile(true);
          return;
        case 'newTab':
          event.preventDefault();
          newTab();
          return;
        case 'palette':
          event.preventDefault();
          if (paletteOpen) setPaletteOpen(false);
          else openPalette();
          return;
        case 'find':
          if (inOtherField) return;
          event.preventDefault();
          setFindMode('find');
          return;
        case 'replace':
          if (inOtherField) return;
          event.preventDefault();
          setFindMode('replace');
          return;
        case 'workbench':
          event.preventDefault();
          openWorkbench();
          return;
        case 'outline':
          event.preventDefault();
          updatePrefs({ outline: !prefs.outline });
          return;
        case 'shortcuts':
          event.preventDefault();
          setShortcutsOpen(true);
          return;
        default:
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // ------------------------------------------------------------------ Paste and drop
  const handlePaste = async (event) => {
    const data = event.clipboardData;
    if (!data) return;
    const image = Array.from(data.files || []).find((file) => file.type.startsWith('image/'));
    if (image) {
      event.preventDefault();
      loadFileObject(new File([image], image.name || 'pasted-image.png', { type: image.type }));
      return;
    }
    const plain = data.getData('text/plain');
    const html = data.getData('text/html');
    const { start, end } = readSelection();
    if (plain && /\t/.test(plain) && plain.trim().includes('\n') && looksLikeCsv(plain)) {
      event.preventDefault();
      const table = csvToMarkdownTable(plain, { delimiter: 'tab' });
      const applied = applyResult(content, { kind: 'selection', start, end }, table, 'replace');
      updateContent(applied.text, {
        selectionBefore: { start, end },
        selectionAfter: { start: applied.end, end: applied.end },
        kind: 'operation',
      });
      notify('Pasted spreadsheet cells as a Markdown table (undo to revert).', 'info');
      return;
    }
    if (html && /<(p|h[1-6]|ul|ol|table|strong|em|b|i|a|li|blockquote|pre)\b/i.test(html)) {
      event.preventDefault();
      try {
        const { htmlToMarkdown } = await import('../operations/markdown/index.js');
        const markdown = await htmlToMarkdown(html);
        const applied = applyResult(content, { kind: 'selection', start, end }, markdown, 'replace');
        updateContent(applied.text, {
          selectionBefore: { start, end },
          selectionAfter: { start: applied.end, end: applied.end },
          kind: 'operation',
        });
        notify('Pasted rich text as Markdown (undo for the plain text).', 'info');
      } catch {
        const applied = applyResult(content, { kind: 'selection', start, end }, plain, 'replace');
        updateContent(applied.text, {
          selectionBefore: { start, end },
          selectionAfter: { start: applied.end, end: applied.end },
        });
      }
    }
  };

  const [isFileDragging, setIsFileDragging] = useState(false);
  const onDragOver = (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    setIsFileDragging(true);
  };
  const onDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsFileDragging(false);
  };
  const onDrop = (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    setIsFileDragging(false);
    Array.from(event.dataTransfer.files).forEach(loadFileObject);
  };

  // ------------------------------------------------------------------ Preview, scroll sync, divider
  const deferredContent = useDeferredValue(content);
  const previewContent = useDebouncedValue(deferredContent, 250, content.length > LARGE_DOCUMENT);

  useEffect(() => {
    const timer = setTimeout(() => {
      anchorsRef.current = collectAnchors(previewRef.current);
    }, 150);
    return () => clearTimeout(timer);
  }, [previewContent, theme, prefs.focusMode, prefs.dividerPosition]);

  const refreshAnchors = () => {
    if (anchorsRef.current.length === 0) anchorsRef.current = collectAnchors(previewRef.current);
  };

  const onEditorScroll = (event) => {
    if (!prefs.syncScroll || syncingRef.current === 'preview' || !previewRef.current) return;
    syncingRef.current = 'editor';
    refreshAnchors();
    const textarea = event.currentTarget;
    const preview = previewRef.current;
    if (textarea.scrollTop + textarea.clientHeight >= textarea.scrollHeight - 2)
      preview.scrollTop = preview.scrollHeight;
    else
      preview.scrollTop = previewOffsetForLine(
        anchorsRef.current,
        lineAtOffset(lineTopsRef.current, textarea.scrollTop),
        preview.scrollHeight,
      );
    requestAnimationFrame(() => (syncingRef.current = null));
  };

  const onPreviewScroll = (event) => {
    if (!prefs.syncScroll || syncingRef.current === 'editor' || !textareaRef.current) return;
    syncingRef.current = 'preview';
    refreshAnchors();
    const preview = event.currentTarget;
    const textarea = textareaRef.current;
    if (preview.scrollTop + preview.clientHeight >= preview.scrollHeight - 2)
      textarea.scrollTop = textarea.scrollHeight;
    else
      textarea.scrollTop = offsetOfLineIndex(
        lineTopsRef.current,
        lineForPreviewOffset(anchorsRef.current, preview.scrollTop),
      );
    requestAnimationFrame(() => (syncingRef.current = null));
  };

  const contentRef = useRef(null);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) return undefined;
    const onMove = (event) => {
      const rect = contentRef.current?.getBoundingClientRect();
      if (!rect) return;
      updatePrefs({ dividerPosition: Math.max(10, Math.min(90, ((event.clientX - rect.left) / rect.width) * 100)) });
    };
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, updatePrefs]);

  const onDividerKeyDown = (event) => {
    const step = event.shiftKey ? 10 : 2;
    const map = { ArrowLeft: -step, ArrowRight: step, Home: -100, End: 100 };
    if (!(event.key in map)) return;
    event.preventDefault();
    updatePrefs({ dividerPosition: Math.max(10, Math.min(90, prefs.dividerPosition + map[event.key])) });
  };

  const allowImage = useCallback((src) => setAllowedImages((current) => new Set(current).add(src)), []);

  // ------------------------------------------------------------------ Menu
  const stats = useMemo(() => documentStats(content, selection.start, selection.end), [content, selection]);
  const focusMode = prefs.focusMode;
  const setFocusMode = (mode) =>
    updatePrefs({ focusMode: mode, focusTarget: mode === 'none' ? prefs.focusTarget : mode });
  const opItem = (operation) => ({
    label: operation.name,
    title: operation.description,
    onSelect: () => runOperationById(operation.id, {}, {}),
  });

  const menuSections = [
    {
      title: 'File',
      items: [
        { label: 'New document', shortcut: shortcutLabel('newTab'), onSelect: newTab },
        { label: 'Open…', shortcut: shortcutLabel('open'), onSelect: openFile },
        ...recentFiles
          .slice(0, 5)
          .map((entry) => ({ label: `Open recent: ${entry.name}`, onSelect: () => reopenRecent(entry) })),
        {
          label: handlesRef.current.get(activeDoc.id) ? 'Save' : 'Save…',
          shortcut: shortcutLabel('save'),
          onSelect: () => saveFile(false),
        },
        { label: 'Save as…', shortcut: shortcutLabel('saveAs'), onSelect: () => saveFile(true) },
        { label: 'Insert image file…', onSelect: () => imageInputRef.current?.click() },
        { label: isExporting ? 'Exporting PDF…' : 'Export to PDF', disabled: isExporting, onSelect: exportPdfFile },
        { label: 'Export standalone HTML', onSelect: exportHtmlFile },
        { label: 'Print…', onSelect: () => window.print() },
        { label: 'Copy as rich text', onSelect: copyRich },
        {
          label: 'Copy preview as plain text',
          onSelect: () => copyText(previewRef.current?.innerText || '', 'Preview text copied.'),
        },
      ],
    },
    {
      title: 'Edit',
      items: [
        { label: 'Undo', shortcut: shortcutLabel('undo'), disabled: !history.canUndo, onSelect: undo },
        { label: 'Redo', shortcut: shortcutLabel('redo'), disabled: !history.canRedo, onSelect: redo },
        { label: 'Find', shortcut: shortcutLabel('find'), onSelect: () => setFindMode('find') },
        { label: 'Find and replace', shortcut: shortcutLabel('replace'), onSelect: () => setFindMode('replace') },
        { label: 'Search all tools…', shortcut: shortcutLabel('palette'), onSelect: openPalette },
        { label: 'Workbench', shortcut: shortcutLabel('workbench'), onSelect: openWorkbench },
      ],
    },
    {
      title: 'Format Code',
      columns: true,
      items: registry
        .byCategory('Format')
        .filter((op) => !op.id.includes('repair'))
        .map(opItem),
    },
    {
      title: 'Convert',
      columns: true,
      items: registry.list
        .filter(
          (op) =>
            /^data\.(json|xml|yaml)-to-(json|xml|yaml)$/.test(op.id) ||
            ['data.csv-to-json', 'data.json-to-csv', 'table.csv-to-markdown', 'table.markdown-to-csv'].includes(op.id),
        )
        .map(opItem),
    },
    {
      title: 'Markdown',
      columns: true,
      items: [
        'md.toc',
        'table.format-all',
        'md.normalize-fences',
        'md.renumber-lists',
        'md.diagnostics',
        'md.validate-katex',
        'md.validate-mermaid',
        'md.broken-anchors',
      ].map((id) => opItem(registry.get(id))),
    },
    {
      title: 'View',
      items: [
        { label: theme === 'dark' ? 'Light mode' : 'Dark mode', onSelect: toggleTheme },
        {
          label: 'Follow system theme',
          checked: prefs.theme === null,
          onSelect: () => {
            updatePrefs({ theme: null });
            setTheme(initialTheme({ theme: null }));
          },
        },
        {
          label: 'Sync scroll',
          checked: prefs.syncScroll,
          onSelect: () => updatePrefs({ syncScroll: !prefs.syncScroll }),
        },
        {
          label: 'Line numbers',
          checked: prefs.lineNumbers,
          onSelect: () => updatePrefs({ lineNumbers: !prefs.lineNumbers }),
        },
        { label: 'Word wrap', checked: prefs.wordWrap, onSelect: () => updatePrefs({ wordWrap: !prefs.wordWrap }) },
        {
          label: 'Outline',
          checked: prefs.outline,
          shortcut: shortcutLabel('outline'),
          onSelect: () => updatePrefs({ outline: !prefs.outline }),
        },
        {
          label: 'Block remote images',
          checked: prefs.blockRemoteImages,
          onSelect: () => updatePrefs({ blockRemoteImages: !prefs.blockRemoteImages }),
        },
        {
          label: 'Preview operations before applying',
          checked: prefs.previewBeforeApply,
          onSelect: () => updatePrefs({ previewBeforeApply: !prefs.previewBeforeApply }),
        },
        { label: 'Keyboard shortcuts', shortcut: shortcutLabel('shortcuts'), onSelect: () => setShortcutsOpen(true) },
      ],
    },
    {
      title: 'Privacy',
      items: [
        {
          label: 'Anonymous analytics',
          checked: consent === 'granted',
          onSelect: () => decideConsent(consent === 'granted' ? 'denied' : 'granted'),
        },
      ],
    },
  ];

  const saveState = activeDoc.dirty
    ? handlesRef.current.get(activeDoc.id)
      ? 'Unsaved changes'
      : 'Saved in browser'
    : 'Saved';

  return (
    <div
      className={`md-viewer-container ${theme} ${isFileDragging ? 'file-dragging' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <a
        href="#markdown-editor"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          textareaRef.current?.focus();
        }}
      >
        Skip to editor
      </a>
      <header className="app-header">
        <div className="header-left">
          <AppMenu sections={menuSections} />
          <div className="app-logo">
            <span className="logo-text">Speculo</span>
          </div>
        </div>
        <div className="header-center">
          <TabBar documents={documents} activeId={activeId} onSelect={selectTab} onClose={closeTab} onNew={newTab} />
        </div>
        <div className="header-right">
          <button
            type="button"
            onClick={openPalette}
            className="header-btn header-btn-labeled"
            title={`Tools (${shortcutLabel('palette')}) — or right-click in the editor or preview`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M15 4V2" />
              <path d="M15 16v-2" />
              <path d="M8 9h2" />
              <path d="M20 9h2" />
              <path d="M17.8 11.8 19 13" />
              <path d="M17.8 6.2 19 5" />
              <path d="m3 21 9-9" />
              <path d="M12.2 6.2 11 5" />
            </svg>
            <span>Tools</span>
          </button>
          <button
            type="button"
            className="header-btn"
            onClick={openWorkbench}
            aria-label="Workbench"
            aria-pressed={Boolean(workbench)}
            title={`Workbench (${shortcutLabel('workbench')})`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="9" y1="10" x2="9" y2="20" />
            </svg>
          </button>
          <button
            type="button"
            className="header-btn"
            onClick={() => copyText(previewRef.current?.innerText || '', 'Preview content copied to clipboard!')}
            aria-label="Copy preview text"
            title="Copy preview text"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            type="button"
            className="header-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            type="button"
            className="header-btn"
            onClick={() => setFocusMode(focusMode === 'none' ? prefs.focusTarget : 'none')}
            aria-label={focusMode !== 'none' ? 'Exit focus mode' : 'Focus mode'}
            aria-pressed={focusMode !== 'none'}
            title={focusMode !== 'none' ? 'Exit focus mode' : 'Focus mode'}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              {focusMode !== 'none' ? (
                <>
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                </>
              ) : (
                <>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                </>
              )}
            </svg>
          </button>
        </div>
      </header>

      <input
        type="file"
        ref={fileInputRef}
        accept={FILE_ACCEPT}
        hidden
        onChange={(event) => {
          loadFileObject(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        type="file"
        ref={imageInputRef}
        accept="image/*"
        hidden
        onChange={(event) => {
          loadFileObject(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <StatusToast status={status} onDismiss={clearStatus} />
      <FormatToolbar onAction={formatAction} shortcutLabel={shortcutLabel} />

      <div className="mobile-switch" role="tablist" aria-label="Pane">
        <button type="button" role="tab" aria-selected={focusMode !== 'preview'} onClick={() => setFocusMode('editor')}>
          Editor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={focusMode === 'preview'}
          onClick={() => setFocusMode('preview')}
        >
          Preview
        </button>
      </div>

      <main className={`editor-area focus-${focusMode}`}>
        {focusMode !== 'none' && (
          <div className="focus-overlay">
            <div className="focus-switch" role="group" aria-label="Focus pane">
              <button
                type="button"
                className={`focus-switch-option${focusMode === 'editor' ? ' selected' : ''}`}
                aria-pressed={focusMode === 'editor'}
                onClick={() => setFocusMode('editor')}
              >
                Editor
              </button>
              <button
                type="button"
                className={`focus-switch-option${focusMode === 'preview' ? ' selected' : ''}`}
                aria-pressed={focusMode === 'preview'}
                onClick={() => setFocusMode('preview')}
              >
                Preview
              </button>
            </div>
            <button type="button" className="focus-overlay-exit" onClick={() => setFocusMode('none')}>
              Exit Focus
            </button>
          </div>
        )}
        {prefs.outline && (
          <OutlinePanel
            markdown={content}
            cursorLine={stats.cursorLine}
            onJump={jumpToLine}
            onClose={() => updatePrefs({ outline: false })}
          />
        )}
        <div className="content-wrapper" ref={contentRef}>
          <div
            className="markdown-input-container"
            id="markdown-editor"
            style={{
              flexBasis: focusMode === 'none' ? `${prefs.dividerPosition}%` : undefined,
              display: focusMode === 'preview' ? 'none' : undefined,
              flexGrow: focusMode === 'editor' ? 1 : undefined,
            }}
          >
            {findMode && (
              <FindReplaceBar
                text={content}
                selectionStart={selection.start}
                showReplace={findMode === 'replace'}
                initialQuery={
                  selection.end > selection.start && !content.slice(selection.start, selection.end).includes('\n')
                    ? content.slice(selection.start, selection.end)
                    : ''
                }
                onSelect={(match) => {
                  const textarea = textareaRef.current;
                  textarea?.setSelectionRange(match.start, match.end);
                  selectionRef.current = match;
                  setSelection(match);
                  const line = content.slice(0, match.start).split('\n').length;
                  if (textarea)
                    textarea.scrollTop = Math.max(0, (lineTopsRef.current[line - 1] ?? 0) - textarea.clientHeight / 3);
                }}
                onReplaceText={(text, sel, message) => {
                  updateContent(text, { selectionAfter: sel || undefined, kind: 'operation' });
                  if (message) notify(message);
                }}
                onClose={() => {
                  setFindMode(null);
                  textareaRef.current?.focus();
                }}
              />
            )}
            <EditorPane
              textareaRef={textareaRef}
              value={content}
              onChange={handleChange}
              onKeyDown={handleEditorKeyDown}
              onScroll={onEditorScroll}
              onSelect={onEditorSelect}
              onFocus={() => (lastPaneRef.current = 'editor')}
              onPaste={handlePaste}
              onContextMenu={onPaneContextMenu('editor')}
              lineNumbers={prefs.lineNumbers}
              wordWrap={prefs.wordWrap}
              onLineTops={(tops) => (lineTopsRef.current = tops)}
            />
          </div>
          {focusMode === 'none' && (
            <div
              className={`resizer ${resizing ? 'active' : ''}`}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize editor and preview"
              aria-valuemin={10}
              aria-valuemax={90}
              aria-valuenow={Math.round(prefs.dividerPosition)}
              aria-controls="markdown-editor"
              tabIndex={0}
              onMouseDown={(event) => {
                event.preventDefault();
                setResizing(true);
              }}
              onKeyDown={onDividerKeyDown}
              onDoubleClick={() => updatePrefs({ dividerPosition: 50 })}
            />
          )}
          <div
            className="preview-area"
            ref={previewRef}
            onScroll={onPreviewScroll}
            onMouseDown={() => (lastPaneRef.current = 'preview')}
            onFocus={() => (lastPaneRef.current = 'preview')}
            onContextMenu={onPaneContextMenu('preview')}
            onKeyDown={(event) => {
              if (isMenuKey(event)) {
                event.preventDefault();
                openToolMenuFromKeyboard('preview');
              }
            }}
            tabIndex={0}
            role="region"
            aria-label="Rendered preview"
            style={{ display: focusMode === 'editor' ? 'none' : undefined }}
          >
            <MarkdownPreview
              markdown={previewContent}
              theme={theme}
              blockRemoteImages={prefs.blockRemoteImages}
              allowedImages={allowedImages}
              onAllowImage={allowImage}
            />
          </div>
        </div>
        {result && (
          <ResultPanel
            result={result}
            onClose={() => setResult(null)}
            onCopy={() => copyText(result.output)}
            onInsert={() => {
              insertAtCursor(result.output);
              setResult(null);
            }}
          />
        )}
      </main>

      {workbench && (
        <Workbench
          registry={registry}
          initialInput={workbench.input}
          initialRecipe={workbench.recipe}
          onClose={() => setWorkbench(null)}
          onRequestSelection={() => {
            const { start, end } = selectionRef.current;
            return content.slice(start, end);
          }}
          onInsert={(text) => {
            insertAtCursor(text);
            notify('Workbench output inserted.');
          }}
          notify={notify}
        />
      )}

      <StatusBar stats={stats} saveState={saveState} fileName={fileName} />

      {toolMenu && (
        <ContextMenu
          entries={toolMenuEntries}
          x={toolMenu.x}
          y={toolMenu.y}
          label="Tools"
          onSelect={onToolMenuSelect}
          onClose={closeToolMenu}
        />
      )}
      {paletteOpen && (
        <OperationPalette
          registry={registry}
          suggestions={paletteSuggestions}
          onClose={() => {
            setPaletteOpen(false);
            setPaletteOperationId(null);
          }}
          onRun={(id, options, flags) => {
            setPaletteOperationId(null);
            runOperationById(id, options, flags);
          }}
          initialPreview={prefs.previewBeforeApply}
          initialOperationId={paletteOperationId}
        />
      )}
      {pendingPreview && (
        <PreviewDialog
          operation={pendingPreview.operation}
          input={pendingPreview.input}
          output={pendingPreview.output}
          warnings={pendingPreview.warnings}
          targetLabel={describeTarget(pendingPreview.target)}
          onReplace={() => applyPending('replace')}
          onInsert={() => applyPending('insert')}
          onCopy={() => copyText(pendingPreview.output)}
          onDownload={() =>
            downloadText(
              pendingPreview.output,
              `${pendingPreview.operation.id.replace(/\W+/g, '-')}.${pendingPreview.operation.outputExtension || 'txt'}`,
              'text/plain;charset=utf-8',
            )
          }
          onCancel={() => setPendingPreview(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog {...confirm} onConfirm={() => closeConfirm(true)} onCancel={() => closeConfirm(false)} />
      )}
      {shortcutsOpen && <ShortcutsDialog mac={mac} onClose={() => setShortcutsOpen(false)} />}
      {consent === null && (
        <ConsentBanner onAccept={() => decideConsent('granted')} onDecline={() => decideConsent('denied')} />
      )}
      {isFileDragging && (
        <div className="drop-overlay" aria-hidden="true">
          Drop a Markdown file to open it, or an image to embed it
        </div>
      )}
    </div>
  );
}
