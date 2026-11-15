// Guarded localStorage access. Storage can be unavailable (private mode, blocked site data) or full; the app
// must keep working, so every access is wrapped and failures fall back to defaults.

export const KEYS = {
  documents: 'speculo.documents.v1',
  legacyDocument: 'speculo.document.v1',
  prefs: 'speculo.prefs.v1',
  paletteRecents: 'speculo.palette.recents.v1',
  paletteFavourites: 'speculo.palette.favourites.v1',
  recentFiles: 'speculo.recentFiles.v1',
  consent: 'speculo.analyticsConsent.v1',
};

const getStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readJson(key, fallback, storage = getStorage()) {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value, storage = getStorage()) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_PREFS = Object.freeze({
  theme: null, // null → follow prefers-color-scheme
  dividerPosition: 50,
  syncScroll: true,
  focusMode: 'none',
  focusTarget: 'editor',
  lineNumbers: true,
  wordWrap: true,
  blockRemoteImages: false,
  previewBeforeApply: false,
  outline: false,
});

export function loadPrefs(storage) {
  const stored = readJson(KEYS.prefs, {}, storage);
  const prefs = { ...DEFAULT_PREFS, ...(stored && typeof stored === 'object' ? stored : {}) };
  prefs.dividerPosition = Math.min(90, Math.max(10, Number(prefs.dividerPosition) || 50));
  if (!['none', 'editor', 'preview'].includes(prefs.focusMode)) prefs.focusMode = 'none';
  if (!['light', 'dark', null].includes(prefs.theme)) prefs.theme = null;
  return prefs;
}

export const savePrefs = (prefs, storage) => writeJson(KEYS.prefs, prefs, storage);

export function initialTheme(prefs, matchMedia = globalThis.matchMedia) {
  if (prefs.theme) return prefs.theme;
  try {
    return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Autosaved documents: [{ id, fileName, content, savedAt, dirty }], plus which one is active. */
export function loadDocuments(storage) {
  const stored = readJson(KEYS.documents, null, storage);
  if (stored && Array.isArray(stored.documents) && stored.documents.length) {
    const documents = stored.documents
      .filter((doc) => doc && typeof doc.content === 'string')
      .map((doc) => ({
        id: String(doc.id),
        fileName: String(doc.fileName || 'document.md'),
        content: doc.content,
        dirty: Boolean(doc.dirty),
        savedAt: doc.savedAt,
      }));
    if (documents.length)
      return {
        documents,
        activeId: documents.some((doc) => doc.id === stored.activeId) ? stored.activeId : documents[0].id,
      };
  }
  const legacy = readJson(KEYS.legacyDocument, null, storage);
  if (legacy && typeof legacy.content === 'string') {
    return {
      documents: [{ id: 'doc-1', fileName: legacy.fileName || 'document.md', content: legacy.content, dirty: true }],
      activeId: 'doc-1',
    };
  }
  return null;
}

export function saveDocuments(documents, activeId, storage) {
  return writeJson(
    KEYS.documents,
    {
      activeId,
      savedAt: new Date().toISOString(),
      documents: documents.map(({ id, fileName, content, dirty }) => ({ id, fileName, content, dirty })),
    },
    storage,
  );
}

export function pushRecent(key, value, { limit = 10, storage, equals = (a, b) => a === b } = {}) {
  const list = readJson(key, [], storage);
  const next = [value, ...(Array.isArray(list) ? list : []).filter((item) => !equals(item, value))].slice(0, limit);
  writeJson(key, next, storage);
  return next;
}
