import { normalizeWorkspacePath, type WorkspaceEntry } from './tree-model.ts';
import type { ReaderDocument } from './types';
import type { WorkspaceFile } from './storage';

/** Reconcile saved tree links without changing Markdown or replacing document IDs. */
export function restoreWorkspaceState(
  savedEntries: Iterable<WorkspaceEntry>,
  history: ReaderDocument[],
  savedDocuments: ReaderDocument[],
  drafts: ReaderDocument[],
  savedFiles: WorkspaceFile[] = [],
): { documents: Map<string, ReaderDocument>; entries: Map<string, WorkspaceEntry> } {
  const documents = new Map<string, ReaderDocument>();
  for (const doc of [...savedDocuments, ...history]) {
    const previous = documents.get(doc.id);
    if (!previous || doc.openedAt > previous.openedAt) documents.set(doc.id, doc);
  }
  // A draft is the user's edited copy even if the original file was opened later.
  for (const doc of drafts) documents.set(doc.id, doc);
  const relocated = new Map<string, string>();
  for (const file of savedFiles) if (file.kind === 'document') {
    const draft = drafts.find(doc => doc.id === file.document.id);
    const latest = draft && draft.openedAt > file.document.openedAt ? draft : file.document;
    documents.set(latest.id, { ...latest, path: file.path, name: file.path.split('/').at(-1)! });
    relocated.set(latest.id, file.path);
  }

  const byPath = new Map<string, ReaderDocument>();
  const draftIds = new Set(drafts.map(doc => doc.id));
  for (const doc of documents.values()) {
    if (doc.origin === 'sample') continue;
    const path = normalizeWorkspacePath(doc.path ?? doc.name);
    if (!path) continue;
    const previous = byPath.get(path);
    if (!previous || (draftIds.has(doc.id) && !draftIds.has(previous.id))
      || (draftIds.has(doc.id) === draftIds.has(previous.id) && doc.openedAt > previous.openedAt)) byPath.set(path, doc);
  }

  const entries = new Map<string, WorkspaceEntry>();
  for (const entry of savedEntries) {
    const path = normalizeWorkspacePath(entry.path);
    if (!path) continue;
    if (entry.documentId && relocated.has(entry.documentId) && relocated.get(entry.documentId) !== path) continue;
    if (entry.assetId && savedFiles.some(file => file.id === entry.assetId && file.path !== path)) continue;
    const linked = documents.get(entry.documentId ?? '');
    entries.set(path, { ...entry, path, documentId: linked?.id ?? byPath.get(path)?.id ?? entry.documentId });
  }
  for (const [path, doc] of byPath) {
    if (!entries.has(path)) entries.set(path, { path, documentId: doc.id });
  }
  for (const file of savedFiles) {
    if (!normalizeWorkspacePath(file.path)) continue;
    if (file.kind === 'folder') entries.set(file.path, { path: file.path, kind: 'folder' });
    if (file.kind === 'file') entries.set(file.path, { path: file.path, assetId: file.id });
  }
  return { documents, entries };
}
