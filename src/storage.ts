import type { ReaderDocument } from './types';

const portable = import.meta.env?.MODE === 'portable';
const DATABASE = portable ? 'shiori-portable' : 'shiori-reader';
const PREFERENCE_PREFIX = portable ? 'shiori-portable' : 'shiori';
const STORE = 'documents';
const DRAFTS = 'drafts';
const WORKSPACE = 'workspace-documents';
const FILES = 'files';
const SESSION = 'single-document';
const HISTORY_LIMIT = 12;
const connections = new Map<string, Promise<IDBDatabase | undefined>>();
const temporaryStores = new Map<string, Map<string, unknown>>();
let temporaryStorage = false;

export function usesTemporaryStorage(): boolean { return temporaryStorage; }
function memoryStore(name: string): Map<string, unknown> {
  if (!temporaryStores.has(name)) temporaryStores.set(name, new Map());
  return temporaryStores.get(name)!;
}

function database(storeName: string): Promise<IDBDatabase | undefined> {
  if (temporaryStorage) return Promise.resolve(undefined);
  const name = storeName === SESSION ? `${DATABASE}-session` : storeName === DRAFTS ? `${DATABASE}-drafts` : storeName === WORKSPACE ? `${DATABASE}-workspace` : storeName === FILES ? `${DATABASE}-files` : DATABASE;
  const existing = connections.get(name);
  if (existing) return existing;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    // New storage is separate: an older open reader never blocks workspace migration.
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connections.delete(name); };
      resolve(request.result);
    };
    request.onerror = () => { connections.delete(name); reject(request.error); };
  }).catch(error => {
    connections.delete(name);
    if (!portable) throw error;
    // Local HTML may run without permission to open browser storage.
    // Keep the editor usable in memory and show the persistent save notice.
    temporaryStorage = true;
    return undefined;
  });
  connections.set(name, pending);
  return pending;
}

interface StoreAccess {
  getAll(): { result: unknown[] };
  put(value: { id: string }): { result: IDBValidKey };
  clear(): { result: undefined };
  delete(key: string): { result: undefined };
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: StoreAccess) => { result: T }, storeName = STORE): Promise<T> {
  const db = await database(storeName);
  if (!db || temporaryStorage) {
    const values = memoryStore(storeName);
    return operation({
      getAll: () => ({ result: structuredClone([...values.values()]) }),
      put: value => { values.set(value.id, structuredClone(value)); return { result: value.id }; },
      clear: () => { values.clear(); return { result: undefined }; },
      delete: key => { values.delete(key); return { result: undefined }; },
    }).result;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getRecentDocuments(): Promise<ReaderDocument[]> {
  const all = await transaction('readonly', store => store.getAll());
  return (all as ReaderDocument[]).sort((a, b) => b.openedAt - a.openedAt);
}

export async function saveDocument(document: ReaderDocument): Promise<void> {
  if (document.origin === 'sample') return;
  await transaction('readwrite', store => store.put(document));
  const all = await getRecentDocuments();
  for (const older of all.slice(HISTORY_LIMIT)) await transaction('readwrite', store => store.delete(older.id));
}

export async function clearHistory(): Promise<void> {
  await transaction('readwrite', store => store.clear());
  await transaction('readwrite', store => store.clear(), DRAFTS);
  await transaction('readwrite', store => store.clear(), WORKSPACE);
  await transaction('readwrite', store => store.clear(), FILES);
}

export type WorkspaceFile = { id: string; path: string } & (
  { kind: 'folder' } | { kind: 'file'; blob: Blob; name: string; lastModified: number } | { kind: 'document'; document: ReaderDocument }
);

export async function getWorkspaceFiles(): Promise<WorkspaceFile[]> {
  return await transaction('readonly', store => store.getAll(), FILES) as WorkspaceFile[];
}

export async function saveWorkspaceFile(file: WorkspaceFile): Promise<void> {
  await transaction('readwrite', store => store.put(file), FILES);
}

export async function saveWorkspaceFiles(files: WorkspaceFile[]): Promise<void> {
  const db = await database(FILES);
  if (!db || temporaryStorage) {
    const copies = structuredClone(files);
    for (const file of copies) memoryStore(FILES).set(file.id, file);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILES, 'readwrite');
    for (const file of files) tx.objectStore(FILES).put(file);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function deleteWorkspaceRecords(documentIds: Iterable<string>, fileIds: Iterable<string>): Promise<void> {
  const ids = [...documentIds];
  const removeKeys = async (storeName: string, keys: string[]) => {
    if (!keys.length) return;
    const db = await database(storeName);
    if (!db || temporaryStorage) { for (const key of keys) memoryStore(storeName).delete(key); return; }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      for (const key of keys) tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  // Remove every body copy before its canonical file record, including legacy history.
  await Promise.all([STORE, DRAFTS, WORKSPACE].map(storeName => removeKeys(storeName, ids)));
  await removeKeys(FILES, [...fileIds]);
}

// Workspace bodies survive the reading cache's twelve-document limit.
export async function getWorkspaceDocuments(): Promise<ReaderDocument[]> {
  return await transaction('readonly', store => store.getAll(), WORKSPACE) as ReaderDocument[];
}

export async function saveWorkspaceDocument(document: ReaderDocument): Promise<void> {
  if (document.origin !== 'sample') await transaction('readwrite', store => store.put(document), WORKSPACE);
}

export async function saveWorkspaceDocuments(documents: Iterable<ReaderDocument>): Promise<void> {
  const db = await database(WORKSPACE);
  if (!db || temporaryStorage) {
    const copies = structuredClone([...documents].filter(doc => doc.origin !== 'sample'));
    for (const doc of copies) memoryStore(WORKSPACE).set(doc.id, doc);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKSPACE, 'readwrite');
    for (const doc of documents) if (doc.origin !== 'sample') tx.objectStore(WORKSPACE).put(doc);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// Drafts are independent of the twelve-document reading cache and never pruned.
export async function getDraftDocuments(): Promise<ReaderDocument[]> {
  return await transaction('readonly', store => store.getAll(), DRAFTS) as ReaderDocument[];
}

export async function saveDraftDocument(document: ReaderDocument): Promise<void> {
  await transaction('readwrite', store => store.put(document), DRAFTS);
}

export function readPreference<T>(name: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(`${PREFERENCE_PREFIX}:${name}`) ?? 'null') ?? fallback; } catch { return fallback; }
}

export function writePreference(name: string, value: unknown): void {
  try { localStorage.setItem(`${PREFERENCE_PREFIX}:${name}`, JSON.stringify(value)); } catch { /* Preferences are optional. */ }
}

export interface EditorSession { document: ReaderDocument; dirty: boolean; nativeToken?: string; assets: { path: string; file: File }[]; }
export async function saveEditorSession(session: EditorSession): Promise<void> {
  await transaction('readwrite', store => store.put({ id: 'current', ...session }), SESSION);
}
export async function loadEditorSession(): Promise<EditorSession | undefined> {
  const sessions = await transaction('readonly', store => store.getAll(), SESSION) as (EditorSession & { id: string })[];
  const current = sessions.find(session => session.id === 'current');
  if (current) return current;
  // Recover only the previously open document. Keep older workspace data intact.
  const id = readPreference<string>('lastDocument', '');
  if (!id || id.startsWith('sample-')) return;
  const [drafts, workspace, history, assets] = await Promise.all([getDraftDocuments(), getWorkspaceDocuments(), getRecentDocuments(), getWorkspaceFiles()]);
  const document = [...drafts, ...workspace, ...history].find(doc => doc.id === id);
  if (!document) return;
  return { document, dirty: drafts.some(doc => doc.id === id), assets: assets.filter((asset): asset is WorkspaceFile & { kind: 'file' } => asset.kind === 'file').map(asset => ({ path: asset.path, file: new File([asset.blob], asset.name, { lastModified: asset.lastModified, type: asset.blob.type }) })) };
}
