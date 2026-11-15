// File open/save with the File System Access API where available, falling back to <input type=file> and download.
import { FILE_ACCEPT } from '../editor/textEditing.js';

export const supportsFileSystemAccess = () =>
  typeof window !== 'undefined' &&
  typeof window.showOpenFilePicker === 'function' &&
  typeof window.showSaveFilePicker === 'function';

const PICKER_TYPES = [
  {
    description: 'Markdown',
    accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.mdx'], 'text/plain': ['.txt'] },
  },
];

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const downloadText = (content, fileName, type = 'text/markdown;charset=utf-8') =>
  downloadBlob(new Blob([content], { type }), fileName);

/** Open a file. Resolves to { name, content, handle } or null when cancelled. */
export async function openWithPicker() {
  if (!supportsFileSystemAccess()) return null;
  try {
    const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    const file = await handle.getFile();
    return { name: file.name, content: await file.text(), handle };
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  }
}

async function ensureWritePermission(handle) {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/**
 * Save a document. Writes in place when a handle exists, asks for a location with the save picker when supported,
 * and otherwise downloads. Resolves to { handle, name, method } or null when cancelled.
 */
export async function saveDocument(content, { fileName, handle, saveAs = false } = {}) {
  if (handle && !saveAs && (await ensureWritePermission(handle))) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return { handle, name: handle.name, method: 'in-place' };
  }
  if (supportsFileSystemAccess()) {
    try {
      const newHandle = await window.showSaveFilePicker({ suggestedName: fileName, types: PICKER_TYPES });
      const writable = await newHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return { handle: newHandle, name: newHandle.name, method: 'picker' };
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      throw error;
    }
  }
  downloadText(content, fileName);
  return { handle: null, name: fileName, method: 'download' };
}

export async function readFile(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------------------- File handles in IndexedDB (recent files)
const DB_NAME = 'speculo';
const STORE = 'fileHandles';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function rememberHandle(key, handle) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function recallHandle(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function reopenHandle(handle) {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) !== 'granted') {
    if ((await handle.requestPermission({ mode: 'read' })) !== 'granted')
      throw new Error('Permission to read the file was denied.');
  }
  const file = await handle.getFile();
  return { name: file.name, content: await file.text(), handle };
}

export { FILE_ACCEPT };
