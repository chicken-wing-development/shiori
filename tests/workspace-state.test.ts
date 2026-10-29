import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreWorkspaceState } from '../src/workspace-state.ts';
import type { ReaderDocument } from '../src/types';

const doc = (id: string, path: string, content = '# 元の文章\r\n\r\n```mermaid\r\nflowchart LR\r\n A --> B\r\n```', openedAt = 1): ReaderDocument => ({ id, path, name: path.split('/').at(-1)!, content, openedAt, origin: 'local' });

test('old history is linked by normalized path without modifying IDs, Markdown or image entries', () => {
  const original = doc('original-id', 'プロジェクトA/1.md');
  const state = restoreWorkspaceState([{ path: 'プロジェクトA\\1.md' }, { path: 'プロジェクトA/img/1.png' }], [original], [], []);
  assert.equal(state.entries.get('プロジェクトA/1.md')?.documentId, 'original-id');
  assert.deepEqual(state.documents.get('original-id'), original);
  assert.ok(state.entries.has('プロジェクトA/img/1.png'));
});

test('a dangling tree ID is repaired by exact path without mixing equal filenames in different projects', () => {
  const a = doc('a', 'A/1.md', 'A');
  const b = doc('b', 'B/1.md', 'B');
  const state = restoreWorkspaceState([{ path: 'A/1.md', documentId: 'missing' }, { path: 'B/1.md', documentId: 'b' }], [a, b], [], []);
  assert.equal(state.entries.get('A/1.md')?.documentId, 'a');
  assert.equal(state.entries.get('B/1.md')?.documentId, 'b');
});

test('draft wins over a later reopened file and unrelated draft-only documents remain available', () => {
  const original = doc('a', 'A/1.md', 'ファイル', 10);
  const draft = { ...original, content: '編集中\n\n| 列 |\n| --- |\n| 値 |', openedAt: 5 };
  const other = doc('draft-only', 'メモ.md', '未保存のメモ');
  const state = restoreWorkspaceState([{ path: original.path!, documentId: 'a' }], [original], [original], [draft, other]);
  assert.equal(state.documents.get('a')?.content, draft.content);
  assert.equal(state.entries.get('メモ.md')?.documentId, 'draft-only');
});

test('workspace bodies outlive the twelve-document history limit and restoration is idempotent', () => {
  const saved = Array.from({ length: 20 }, (_, i) => doc(`id-${i}`, `A/${i}.md`, `本文${i}`, i));
  const state = restoreWorkspaceState([], saved.slice(-12), saved, []);
  assert.equal(state.documents.size, 20);
  assert.equal(state.entries.size, 20);
  const again = restoreWorkspaceState(state.entries.values(), [], [...state.documents.values()], []);
  assert.deepEqual([...again.documents.values()], [...state.documents.values()]);
  assert.deepEqual([...again.entries.values()], [...state.entries.values()]);
});

test('moves restore atomically saved document paths and links ahead of legacy copies, while later edits win', () => {
  const before = doc('a', 'A/1.md', '![図](1.png)', 1);
  const moved = { ...before, path: 'B/1.md', content: '![図](../A/img/1.png)', openedAt: 5 };
  const fileRecords = [
    { id: 'document:a', path: 'B/1.md', kind: 'document' as const, document: moved },
    { id: 'folder:B', path: 'B', kind: 'folder' as const },
    { id: 'image-id', path: 'A/img/1.png', kind: 'file' as const, name: '1.png', blob: new Blob(['image']), lastModified: 1 },
  ];
  const entries = [{ path: 'A/1.md', documentId: 'a' }, { path: 'A/1.png', assetId: 'image-id' }];
  const state = restoreWorkspaceState(entries, [before], [before], [before], fileRecords);
  assert.equal(state.documents.get('a')?.path, 'B/1.md');
  assert.equal(state.documents.get('a')?.content, moved.content);
  assert.ok(!state.entries.has('A/1.md') && !state.entries.has('A/1.png'));
  assert.equal(state.entries.get('B')?.kind, 'folder');
  assert.equal(state.entries.get('A/img/1.png')?.assetId, 'image-id');
  const later = restoreWorkspaceState(entries, [], [], [{ ...moved, content: '移動後の編集', openedAt: 10 }], fileRecords);
  assert.equal(later.documents.get('a')?.content, '移動後の編集');
});
