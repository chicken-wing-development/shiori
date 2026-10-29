import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarkdownManager } from '@tiptap/markdown';
import { getSchema } from '@tiptap/core';
import { createEditorExtensions } from '../src/editor-schema.ts';
import { compileMarkdown } from '../src/markdown.ts';
import { resolveLocalPath } from '../src/files.ts';

const manager = () => new MarkdownManager({ extensions: createEditorExtensions() });

test('rich edits preserve Markdown headings, marks, nested lists, tasks, tables and local links', () => {
  const parser = manager();
  const source = '# 日本語\n\n**太字** *斜体* ~~削除~~ `code`\n\n- 親\n  - 子\n\n3. 番号\n\n- [x] 完了\n- [ ] 未完了\n\n| 列A | 列B |\n| :--- | ---: |\n| ひとつ | ふたつ |\n\n> 引用\n\n#### 詳細\n\n[次へ](../次の章.md#概要)';
  const first = parser.parse(source);
  const markdown = parser.serialize(first);
  const second = parser.parse(markdown);
  assert.deepEqual(second, first);
  const rendered = compileMarkdown(markdown);
  assert.deepEqual(rendered.headings.map(h => h.level), [1, 4]);
  assert.match(rendered.html, /<table>/);
  assert.match(markdown, /- \[x\] 完了/);
  assert.match(markdown, /\.\.\/次の章\.md#概要/);
});

test('Mermaid remains an editable code block and survives rich serialization byte for byte', () => {
  const parser = manager();
  const diagram = 'sequenceDiagram\n  participant A as 利用者\n  A->>A: 確認する\n  Note over A: **記法は文字のまま**';
  const json = parser.parse('```mermaid\n' + diagram + '\n```');
  assert.equal(json.content?.[0].type, 'codeBlock');
  assert.equal(json.content?.[0].attrs?.language, 'mermaid');
  assert.equal(json.content?.[0].content?.[0].text, diagram);
  assert.equal(compileMarkdown(parser.serialize(json)).diagrams[0].source, diagram + '\n');
});

test('code containing backticks gets a long enough fence to remain one code block', () => {
  const parser = manager();
  const code = '```mermaid\nflowchart LR\n A --> B\n```';
  const source = '````markdown\n' + code + '\n````';
  const json = parser.parse(source);
  const restored = parser.parse(parser.serialize(json));
  assert.equal(restored.content?.length, 1);
  assert.equal(restored.content?.[0].content?.[0].text, code);
});

test('HTML and comments stay literal through rich edits, while angle autolinks remain links', () => {
  const parser = manager();
  const source = '<!-- 内容を保持 -->\n\n<script>alert(1)</script>\n\n本文 <b>タグ</b> と <https://example.com>\n\n<img src="https://example.com/tracker.png" onerror="alert(1)">';
  const json = parser.parse(source);
  const markdown = parser.serialize(json);
  assert.match(markdown, /<!-- 内容を保持 -->/);
  assert.match(markdown, /<script>alert\(1\)<\/script>/);
  assert.match(markdown, /<b>タグ<\/b>/);
  assert.match(markdown, /onerror="alert\(1\)"/);
  const types: string[] = [];
  const visit = (node: typeof json) => { types.push(node.type ?? ''); node.content?.forEach(visit); };
  visit(json);
  assert.ok(types.includes('rawBlock'));
  assert.ok(!types.includes('image'));
  assert.match(JSON.stringify(json), /"type":"link"/);
  const html = compileMarkdown(markdown).html;
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
});

test('image paths containing spaces and parentheses retain their target after rich edits', () => {
  const parser = manager();
  const json = parser.parse('![図\\]1](<./img/図 (1).png> "説明")');
  const restored = parser.parse(parser.serialize(json));
  const findImage = (node: typeof json): typeof json | undefined => node.type === 'image' ? node : node.content?.map(findImage).find(Boolean);
  const image = findImage(restored)!;
  assert.equal(image.attrs?.alt, '図]1');
  assert.equal(resolveLocalPath('project/1.md', image.attrs?.src), 'project/img/図 (1).png');
  assert.equal(image.attrs?.title, '説明');
});

test('standalone and inline images produce schema-valid editable documents in all block contexts', () => {
  const extensions = createEditorExtensions();
  const parser = new MarkdownManager({ extensions });
  const schema = getSchema(extensions);
  for (const source of [
    '![図](img/1.png)',
    '# 既存の文章\r\n\r\n![図](img/1.png)\r\n\r\n続きの段落',
    '本文 ![図](img/1.png) 続き',
    '> ![図](img/1.png)',
    '- ![図](img/1.png)\n- 本文',
    '| 図 |\n| --- |\n| ![図](img/1.png) |',
    '[![図](img/1.png)](./次.md)',
    '![図1](img/1.png) ![図2](img/2.png)',
  ]) {
    const json = parser.parse(source);
    assert.doesNotThrow(() => schema.nodeFromJSON(json).check(), source);
    const again = parser.parse(parser.serialize(json));
    assert.doesNotThrow(() => schema.nodeFromJSON(again).check(), source);
    assert.deepEqual(again, json, source);
  }
});
