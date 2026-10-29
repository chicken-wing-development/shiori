import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planWorkspaceRemoval } from '../src/workspace-removal.ts';
import type { ReaderDocument } from '../src/types';

const doc = (id: string, path: string): ReaderDocument => ({ id, path, name: path.split('/').at(-1)!, content: '# 下書き', openedAt: 1, origin: 'local' });

test('removing one file covers duplicate legacy bodies and preserves same-named files elsewhere', () => {
  const result = planWorkspaceRemoval('A/1.md', [{ path: 'A/1.md', documentId: 'new' }, { path: 'B/1.md', documentId: 'other' }], [doc('old', 'A/1.md'), doc('new', 'A/1.md'), doc('other', 'B/1.md')], []);
  assert.deepEqual([...result.documentIds].sort(), ['new', 'old']);
  assert.ok(!result.documentIds.has('other'));
  assert.deepEqual(result.parentFolders, ['A']);
});

test('folder deletion keeps siblings and files moved outside it despite stale tree and history paths', () => {
  const moved = doc('moved', 'A/2.md');
  const files = [
    { id: 'document:moved', path: 'B/2.md', kind: 'document' as const, document: moved },
    { id: 'relocated-image', path: 'B/img/1.png', kind: 'file' as const, blob: new Blob(['png']), name: '1.png', lastModified: 1 },
    { id: 'inside-image', path: 'A/img/2.png', kind: 'file' as const, blob: new Blob(['png']), name: '2.png', lastModified: 1 },
    { id: 'folder:A/img', path: 'A/img', kind: 'folder' as const },
  ];
  const result = planWorkspaceRemoval('A', [{ path: 'A/1.md', documentId: 'inside' }, { path: 'A/2.md', documentId: moved.id }, { path: 'A/img/1.png', assetId: 'relocated-image' }, { path: 'AB/1.md', documentId: 'sibling' }], [doc('inside', 'A/1.md'), moved, doc('sibling', 'AB/1.md')], files);
  assert.ok(result.isFolder);
  assert.deepEqual([...result.documentIds], ['inside']);
  assert.ok(result.fileIds.has('inside-image') && result.fileIds.has('folder:A/img'));
  assert.ok(!result.fileIds.has('relocated-image') && !result.fileIds.has('document:moved'));
  assert.deepEqual(result.parentFolders, []);
});

test('missing image bytes and empty folders can be removed while the workspace root is protected', () => {
  const entries = [{ path: '画像.png', assetId: 'missing-image' }, { path: '空', kind: 'folder' as const }];
  assert.ok(planWorkspaceRemoval('画像.png', entries, [], []).fileIds.has('missing-image'));
  assert.ok(planWorkspaceRemoval('空', entries, [], []).isFolder);
  for (const path of ['', '../A', 'ないファイル.md']) assert.throws(() => planWorkspaceRemoval(path, entries, [], []));
});
