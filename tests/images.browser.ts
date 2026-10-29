import DOMPurify from 'dompurify';
import { compileMarkdown } from '../src/markdown';
import { sanitizeMarkdown } from '../src/sanitize';
import { FileWorkspace } from '../src/files';

const results = document.querySelector<HTMLOListElement>('#results')!;
const rendered = document.querySelector<HTMLElement>('#rendered')!;
let failures = 0;
let checks = 0;

function check(condition: boolean, label: string): void {
  checks++;
  const row = document.createElement('li');
  row.className = condition ? 'pass' : 'fail';
  row.textContent = `${condition ? 'OK' : 'NG'}: ${label}`;
  results.append(row);
  if (!condition) failures++;
}

try {
  const response = await fetch('/icons/icon-192.png');
  if (!response.ok) throw new Error('確認用画像を読み込めませんでした。');
  const file = new File([await response.blob()], 'reading.png', { type: 'image/png' });
  Object.defineProperty(file, 'webkitRelativePath', { value: '文書/images/reading.png' });
  const workspace = new FileWorkspace();
  workspace.addFiles([file]);
  const allowed = new Set<string>();
  const compiled = compileMarkdown('画像の下に「読んでみよう」と表示されます。\n\n![読んでみよう](./images/reading.png)', {
    resolveImage: href => {
      const url = workspace.resolveImage('文書/start.md', href);
      if (url) allowed.add(url);
      return url;
    },
  });
  const oldResult = document.createElement('div');
  oldResult.innerHTML = DOMPurify.sanitize(compiled.html);
  check(oldResult.querySelector('img')?.getAttribute('src') === null, '修正前に画像URLが消える不具合を再現');

  rendered.innerHTML = sanitizeMarkdown(compiled.html, allowed);
  const image = rendered.querySelector<HTMLImageElement>('img')!;
  check(allowed.has(image.getAttribute('src') ?? ''), '日本語フォルダーの相対画像URLを保持');
  image.loading = 'eager';
  await image.decode();
  check(image.naturalWidth === 192 && image.naturalHeight === 192, '画像を実際に読み込み・表示（192 × 192）');

  const untrusted = document.createElement('div');
  untrusted.innerHTML = sanitizeMarkdown(compiled.html);
  check(untrusted.querySelector('img')?.getAttribute('src') === null, '許可リストにないblob URLをブロック');

  const security = document.createElement('div');
  security.innerHTML = sanitizeMarkdown(`<a href="${image.getAttribute('src')}">blob link</a><img src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script>`, allowed);
  check(security.querySelector('a')?.getAttribute('href') === null, '画像以外のblobリンクの制限を維持');
  check(!security.querySelector('script,[onerror],[src^="javascript:"]'), 'スクリプト・イベント属性・危険なURLを除去');
  check(!compileMarkdown('![external](https://example.com/image.png)').html.includes('<img'), '外部画像は初期状態で読み込まない');
} catch (error) {
  check(false, error instanceof Error ? error.message : String(error));
}
document.querySelector('#summary')!.textContent = `${checks - failures} / ${checks} 件成功`;
document.documentElement.dataset.testResult = failures ? 'failed' : 'passed';
