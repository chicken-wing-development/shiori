import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileMarkdown } from '../src/markdown.ts';
import { isMarkdownFile, MAX_DOCUMENT_SIZE, readDocument, resolveLocalPath } from '../src/files.ts';
import { samples } from '../src/samples.ts';
import { buildWorkspaceTree, normalizeWorkspacePath } from '../src/tree-model.ts';
import { FileWorkspace } from '../src/files.ts';

test('Japanese headings and existing numbered headings have unique anchors', () => {
  const result = compileMarkdown('# はじめに\n\n## はじめに-1\n\n## はじめに\n\n## **太字** と `code`');
  assert.deepEqual(result.headings.map(h => h.id), ['はじめに', 'はじめに-1', 'はじめに-2', '太字-と-code']);
  assert.equal(new Set(result.headings.map(h => h.id)).size, result.headings.length);
});

test('raw HTML and JavaScript links cannot become executable Markdown output', () => {
  const result = compileMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)');
  assert.ok(!result.html.includes('<script>'));
  assert.ok(!result.html.includes('<img src=x'));
  assert.ok(!result.html.includes('href="javascript:'));
  assert.ok(result.html.includes('&lt;script&gt;'));
});

test('remote images require explicit permission; SVG data images stay blocked', () => {
  const markdown = '![private](https://example.com/tracker.png)';
  assert.ok(!compileMarkdown(markdown).html.includes('<img'));
  assert.ok(compileMarkdown(markdown, { allowRemoteImages: true }).html.includes('referrerpolicy="no-referrer"'));
  assert.ok(!compileMarkdown('![bad](data:image/svg+xml;base64,PHN2Zz4=)', { allowRemoteImages: true }).html.includes('<img'));
});

test('Mermaid definitions stay in data, and a document renders at most 30 diagrams', () => {
  const source = '```mermaid\nflowchart LR\n A[hello] --> B[world]\n```\n';
  const result = compileMarkdown(source.repeat(32));
  assert.equal(result.diagrams.length, 30);
  assert.equal(result.diagrams[0].source, 'flowchart LR\n A[hello] --> B[world]\n');
  assert.ok(result.html.includes('30個まで'));
});

test('local links resolve folders and encoded Japanese paths without escaping the selection', () => {
  assert.equal(resolveLocalPath('docs/guide/start.md', '../画像/a%20b.png#caption'), 'docs/画像/a b.png');
  assert.equal(resolveLocalPath('docs/start.md', './next.md?x=1#section'), 'docs/next.md');
  assert.equal(resolveLocalPath('docs/start.md', '../../outside.md'), undefined);
  assert.equal(resolveLocalPath('docs/start.md', 'https://example.com/a.md'), undefined);
  assert.equal(resolveLocalPath('docs/start.md', '//example.com/a.md'), undefined);
  assert.equal(resolveLocalPath('docs/start.md', '%broken'), undefined);
});

test('UTF-8 documents open without BOM, with size and extension boundaries', async () => {
  const doc = await readDocument(new File(['\uFEFF# 文書'], '文書.MD'));
  assert.equal(doc.content, '# 文書');
  assert.equal(doc.name, '文書.MD');
  assert.equal(doc.origin, 'local');
  assert.ok(isMarkdownFile('note.markdown'));
  await assert.rejects(readDocument(new File(['x'], 'app.exe')), /Markdownファイル/);
  await assert.rejects(readDocument(new File([new Uint8Array(MAX_DOCUMENT_SIZE + 1)], 'huge.md')), /2 MB/);
});

test('sample documents contain real fenced diagrams and supported Markdown', () => {
  const welcome = compileMarkdown(samples[0].content);
  const mermaid = compileMarkdown(samples[1].content);
  assert.equal(welcome.diagrams.length, 1);
  assert.equal(mermaid.diagrams.length, 4);
  assert.ok(welcome.html.includes('<table>'));
  assert.ok(welcome.html.includes('task-list-item'));
  assert.ok(mermaid.headings.some(h => h.text === 'シーケンス図'));
});

test('workspace preserves loose Markdown, project folders, and image children', () => {
  const tree = buildWorkspaceTree(['テキスト.md', 'プロジェクトA/img/1.png', 'プロジェクトA/1.md']);
  assert.equal(tree.name, 'ワークエリア');
  const project = tree.children.find(node => node.name === 'プロジェクトA')!;
  assert.equal(project.kind, 'folder');
  assert.equal(project.children[0].name, 'img');
  assert.equal(project.children[0].children[0].kind, 'image');
  assert.equal(project.children[0].children[0].path, 'プロジェクトA/img/1.png');
  assert.equal(project.children[1].kind, 'markdown');
  assert.ok(tree.children.some(node => node.path === 'テキスト.md'));
});

test('workspace keeps more than 12 documents, duplicate basenames, and numeric sorting', () => {
  const paths = Array.from({ length: 20 }, (_, index) => `A/${index + 1}.md`);
  const tree = buildWorkspaceTree([...paths, 'B/1.md', 'A/1.md']);
  assert.equal(tree.children[0].children.length, 20);
  assert.deepEqual(tree.children[0].children.slice(0, 3).map(node => node.name), ['1.md', '2.md', '3.md']);
  assert.equal(tree.children[1].children[0].path, 'B/1.md');
});

test('workspace treats prototype names as ordinary folders and rejects parent traversal', () => {
  assert.equal(normalizeWorkspacePath('A\\img\\1.png'), 'A/img/1.png');
  assert.equal(normalizeWorkspacePath('A/../outside.md'), undefined);
  const tree = buildWorkspaceTree(['__proto__/constructor.md', 'A/../outside.md']);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].children[0].path, '__proto__/constructor.md');
});

test('reopening one project replaces its old files and retains other workspace roots', () => {
  const file = (path: string) => {
    const value = new File(['# doc'], path.split('/').at(-1)!);
    Object.defineProperty(value, 'webkitRelativePath', { value: path });
    return value;
  };
  const workspace = new FileWorkspace();
  workspace.addFiles([file('A/old.md'), file('B/keep.md')]);
  workspace.addFiles([file('A/new.md')]);
  assert.deepEqual(workspace.getPaths().sort(), ['A/new.md', 'B/keep.md']);
  assert.equal(workspace.resolveFile('A/new.md', '../B/keep.md')?.name, 'keep.md');
});
