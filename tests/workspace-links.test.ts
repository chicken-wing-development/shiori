import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewriteWorkspaceLinks } from '../src/workspace-links.ts';
import { availableWorkspacePath, buildWorkspaceTree, validWorkspaceName } from '../src/tree-model.ts';

test('image moves change only actual Markdown destinations, retaining code, labels, titles and reference syntax', () => {
  const source = '# 本文\r\n\r\n![図](1.png "説明") と [画像](<1.png>)\r\n\r\n`![文字](1.png)`\r\n\r\n```md\r\n![コード](1.png)\r\n```\r\n\r\n![図][ref]\r\n\r\n[ref]: 1.png "参照画像"\r\n';
  const result = rewriteWorkspaceLinks(source, 'A/1.md', 'A/1.md', 'A/1.png', 'A/img/1.png');
  assert.equal(result, source.replace('![図](1.png', '![図](img/1.png').replace('[画像](<1.png>)', '[画像](<img/1.png>)').replace('[ref]: 1.png', '[ref]: img/1.png'));
});

test('moving Markdown rebases images and links without changing anchors or external URLs', () => {
  const source = '![図](img/a.png) [次](next.md#詳細) [Web](https://example.com) [目次](#目次)';
  assert.equal(rewriteWorkspaceLinks(source, 'A/1.md', 'B/1.md', 'A/1.md', 'B/1.md'), '![図](../A/img/a.png) [次](../A/next.md#詳細) [Web](https://example.com) [目次](#目次)');
});

test('nested links and image destinations with parentheses, spaces and Japanese paths remain valid', () => {
  const source = '[![図](<img/図 (1).png>)](./1.md) ![別](img/a(b).png)';
  const result = rewriteWorkspaceLinks(source, 'A/1.md', 'A/1.md', 'A/img/図 (1).png', 'A/画像/図 (1).png');
  assert.equal(result, '[![図](<%E7%94%BB%E5%83%8F/%E5%9B%B3%20%281%29.png>)](./1.md) ![別](img/a(b).png)');
  assert.equal(rewriteWorkspaceLinks('![図](img/a(b).png)', 'A/1.md', 'A/1.md', 'A/img/a(b).png', 'A/new.png'), '![図](new.png)');
});

test('empty folders persist in the model and file collisions preserve both files', () => {
  const entries = [{ path: 'A', kind: 'folder' as const }, { path: 'A/img', kind: 'folder' as const }, { path: 'A/img/1.png' }, { path: 'A/img/1 (2).png' }];
  assert.equal(buildWorkspaceTree([{ path: '空', kind: 'folder' }]).children[0].kind, 'folder');
  assert.equal(availableWorkspacePath('A/img', '1.png', entries), 'A/img/1 (3).png');
  assert.equal(availableWorkspacePath('', 'A', entries), 'A (2)');
  assert.equal(validWorkspaceName('../外'), false);
  assert.equal(validWorkspaceName('img'), true);
});
