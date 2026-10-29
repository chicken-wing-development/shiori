import { normalizeWorkspacePath, workspaceFolders, type WorkspaceEntry } from './tree-model.ts';
import type { ReaderDocument } from './types';
import type { WorkspaceFile } from './storage';

export function includesWorkspacePath(parent: string, path: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

/** Match canonical paths so deleting an old folder never removes files moved elsewhere. */
export function planWorkspaceRemoval(path: string, entries: Iterable<WorkspaceEntry>, documents: Iterable<ReaderDocument>, files: Iterable<WorkspaceFile>) {
  const allEntries = [...entries];
  if (!path || normalizeWorkspacePath(path) !== path || (!allEntries.some(entry => entry.path === path) && !workspaceFolders(allEntries).includes(path))) throw new Error('削除するファイルまたはフォルダーが見つかりません。');
  const allFiles = [...files];
  const filePaths = new Map(allFiles.map(file => [file.id, file.path]));
  const documentPaths = new Map([...documents].filter(doc => doc.origin !== 'sample').map(doc => [doc.id, doc.path ?? doc.name]));
  for (const file of allFiles) if (file.kind === 'document') documentPaths.set(file.document.id, file.path);
  const documentIds = new Set([...documentPaths].filter(([, value]) => includesWorkspacePath(path, value)).map(([id]) => id));
  const paths = new Set([path]);
  const fileIds = new Set<string>();
  for (const entry of allEntries) if (includesWorkspacePath(path, entry.path)) {
    paths.add(entry.path);
    if (entry.assetId && (!filePaths.has(entry.assetId) || includesWorkspacePath(path, filePaths.get(entry.assetId)!))) fileIds.add(entry.assetId);
    if (entry.documentId && !documentPaths.has(entry.documentId)) documentIds.add(entry.documentId);
  }
  for (const file of allFiles) if (includesWorkspacePath(path, file.path) || (file.kind === 'document' && documentIds.has(file.document.id))) { paths.add(file.path); fileIds.add(file.id); }
  for (const id of documentIds) fileIds.add(`document:${id}`);
  const parentFolders: string[] = [];
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) parentFolders.push(parts.slice(0, i).join('/'));
  return { paths, documentIds, fileIds, parentFolders, isFolder: workspaceFolders(allEntries).includes(path) };
}
