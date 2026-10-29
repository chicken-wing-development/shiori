import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalPath, readDocument } from '../src/files.ts';
import { selectFolderImages } from '../src/folder-images.ts';
import type { ReaderDocument } from '../src/types.ts';
const doc: ReaderDocument = { id: '1', name: 'note.md', path: 'note.md', content: '', openedAt: 0, origin: 'local' };
const file = (path: string) => {
  const value = new File(['image'], path.split('/').at(-1)!);
  Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
};
test('relative paths use one decoding pass and reject encoded protocols and UNC paths', () => {
  assert.equal(resolveLocalPath('note.md', './img/日本語%20画像.png?x#caption'), 'img/日本語 画像.png');
  assert.equal(resolveLocalPath('note.md', 'img/a%23b.png'), 'img/a#b.png');
  assert.equal(resolveLocalPath('note.md', 'img/a%2520b.png'), 'img/a%20b.png');
  assert.equal(resolveLocalPath('note.md', 'img\\sharp1.png'), 'img/sharp1.png');
  for (const source of ['%2e%2e/outside.png', '%2f%2fhost/a.png', '\\\\host\\a.png', 'C%3a/a.png', 'file%3a/a.png', 'img/a%00.png', 'img/a.png:secret', '#fragment']) assert.equal(resolveLocalPath('note.md', source), undefined, source);
});
test('manual selection accepts both document directory and image directory without losing img prefix', () => {
  for (const files of [[file('guide/note.md'), file('guide/img/sharp1.png')], [file('img/sharp1.png')]]) {
    const result = selectFolderImages(files, doc, ['./img/sharp1.png']);
    assert.equal(result.base, 'note.md');
    assert.ok(result.assets.some(asset => asset.path === 'img/sharp1.png'));
  }
});
test('common parent selection retains nested document base and resolves parent image references', () => {
  const result = selectFolderImages([file('project/docs/note.md'), file('project/img/a.svg')], doc, ['../img/a.svg']);
  assert.equal(result.base, 'docs/note.md');
  assert.ok(result.assets.some(asset => asset.path === 'img/a.svg'));
  assert.ok(!selectFolderImages([file('wrong/unrelated.png')], doc, ['./img/sharp1.png']).assets.some(asset => asset.path === 'img/sharp1.png'));
});
test('browser and native input both reject non-UTF8 documents instead of silently replacing text', async () => {
  await assert.rejects(readDocument(new File([new Uint8Array([0xff, 0xfe])], 'bad.md')), /UTF-8/);
});
