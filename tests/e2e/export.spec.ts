import { test, expect } from '@playwright/test';

async function fixture(page: import('@playwright/test').Page) {
  await page.goto('/tests/editor.html');
  await expect(page.locator('#editor-test-ready')).toHaveText('fixture ready');
  await expect(page.locator('#preview svg')).toHaveCount(1);
}
async function save(page: import('@playwright/test').Page) {
  await page.locator('#save-button').click();
  await page.locator('#confirm-save').click();
  await expect(page.locator('#editor-test-export')).not.toBeEmpty();
  return (await page.locator('#editor-test-export').textContent())!;
}

test('manual common-folder selection resolves parent paths and SVG across session restore', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.locator('#file-input').setInputFiles({ name: 'nested.md', mimeType: 'text/markdown', buffer: Buffer.from('![SVG](../img/日本語%20図.svg)') });
  await page.evaluate(() => {
    const files = new DataTransfer();
    for (const [path, content] of [['project/docs/nested.md', '# Doc'], ['project/img/日本語 図.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>']]) {
      const file = new File([content], path.split('/').at(-1)!);
      Object.defineProperty(file, 'webkitRelativePath', { value: path }); files.items.add(file);
    }
    const input = document.querySelector<HTMLInputElement>('#folder-input')!;
    input.files = files.files; input.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#preview img')).toHaveCount(1);
  await page.locator('#preview-tab').click();
  await expect.poll(() => page.locator('#preview img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(20);
  await expect(page.locator('#document-status')).not.toContainText('自動保存中');
  await page.reload(); await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#preview img')).toHaveCount(1);
  await expect.poll(() => page.locator('#preview img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(20);
});

test('plain Markdown save preserves all text and does not convert images or Mermaid', async ({ page }) => {
  await fixture(page);
  const source = await page.locator('#markdown-input').inputValue();
  expect(await save(page)).toBe(source);
  await expect(page.locator('#embed-images, #embed-mermaid, #sidebar, #workspace-tree, #sample-list')).toHaveCount(0);
  expect(await page.locator('#file-input').getAttribute('multiple')).toBeNull();
});


async function exportHtml(page: import('@playwright/test').Page) {
  await page.locator('#file-menu summary').click();
  await page.locator('#html-export-button').click();
  await page.locator('#confirm-export').click();
}

test('HTML is a standalone offline document with images, SVG diagrams and working anchors', async ({ page, context }, testInfo) => {
  await fixture(page);
  await page.locator('#source-tab').click();
  const source = (await page.locator('#markdown-input').inputValue()) + '\n[Jump](#今日のタスク)\n';
  await page.locator('#markdown-input').fill(source);
  await exportHtml(page);
  await expect(page.locator('#editor-test-export')).toContainText('<!doctype html>');
  const html = (await page.locator('#editor-test-export').textContent())!;
  expect(html).toContain('data:image/png;base64,');
  expect(html).toContain('data:image/svg+xml;base64,');
  expect(html).not.toMatch(/<script|blob:|data-copy-code|data-save-diagram|loading="lazy"/);
  await expect(page.locator('#dirty-mark')).toBeVisible();
  await expect(page.locator('#document-name')).toHaveText('1.md');
  await expect(page.locator('#markdown-input')).toHaveValue(source);
  const offline = await context.newPage(); await context.setOffline(true);
  await offline.setContent(html);
  await expect(offline.locator('img')).toHaveCount(2);
  await expect.poll(() => offline.locator('img').evaluateAll(imgs => imgs.every(i => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(offline.locator('a').filter({ hasText: '参考資料' })).toHaveAttribute('href', './reference.md');
  await offline.locator('a').filter({ hasText: 'Jump' }).click();
  await expect(offline.locator('h2').first()).toHaveAttribute('id', '今日のタスク');
  await offline.screenshot({ path: testInfo.outputPath('offline-html.png'), fullPage: true });
});

test('HTML handles shared image references without converting links or code samples', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const { buildHtmlDocument } = await import('/src/export-document.ts');
    const content = '# 文書\n\n![a](<img/日本語%20図.png> "title")\n\n![ref][shared]\n\n[link][shared]\n\n[shared]: img/日本語%20図.png\n\n\x60![code](missing.png)\x60';
    const blob = await (await fetch('/icons/icon-192.png')).blob();
    const seen: string[] = [];
    const output = await buildHtmlDocument(content, { title: '<script>title</script>', resolveImageFile: source => { seen.push(source); return new File([blob], '図.png'); } });
    const doc = new DOMParser().parseFromString(output.content, 'text/html');
    return { count: output.images, seen, link: doc.querySelector('a')?.getAttribute('href'), code: doc.querySelector('code')?.textContent, title: doc.title, scripts: doc.scripts.length };
  });
  expect(result.count).toBe(2); expect(result.seen).toHaveLength(1);
  expect(decodeURI(result.link!)).toBe('img/日本語 図.png');
  expect(result.code).toBe('![code](missing.png)'); expect(result.scripts).toBe(0);
  expect(result.title).toBe('<script>title</script>');
});

test('HTML converts Mermaid fences in lists and quotes and rejects excess diagrams', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const { buildHtmlDocument } = await import('/src/export-document.ts');
    const output = await buildHtmlDocument('> ~~~mermaid\n> flowchart LR\n> A[日本語] --> B[図]\n> ~~~\n\n- ~~~mermaid\n  flowchart LR\n  A --> B\n  ~~~\n', { title: '図' });
    let error = ''; try { await buildHtmlDocument('~~~mermaid\nflowchart LR\nA-->B\n~~~\n\n'.repeat(31), { title: 'limit' }); } catch (e) { error = String(e); }
    const doc = new DOMParser().parseFromString(output.content, 'text/html');
    return { count: output.diagrams, quote: doc.querySelectorAll('blockquote img').length, list: doc.querySelectorAll('li img').length, error };
  });
  expect(result).toMatchObject({ count: 2, quote: 1, list: 1 }); expect(result.error).toContain('30個');
});

test('WYSIWYG Markdown save includes latest text and retains missing image and invalid Mermaid source', async ({ page }) => {
  await fixture(page); await page.locator('#wysiwyg-tab').click();
  await page.getByRole('textbox', { name: 'WYSIWYG編集', exact: true }).fill('未保存の最新テキスト <script>alert(1)</script>');
  expect(await save(page)).toContain('未保存の最新テキスト');
  await page.locator('#source-tab').click();
  const source = '![missing](missing.png)\n\n~~~mermaid\nnot-a-diagram\n~~~';
  await page.locator('#markdown-input').fill(source);
  await page.evaluate(() => { document.querySelector('#editor-test-export')!.textContent = ''; });
  expect(await save(page)).toBe(source);
});

test('export failures never create a writable file or clear unsaved changes', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { Object.assign(window, { writes: 0, showSaveFilePicker: async () => ({ createWritable: async () => { (window as any).writes++; return { write: async () => {}, close: async () => {} }; } }) }); });
  for (const source of ['![missing](missing.png)', '~~~mermaid\nnot-a-diagram\n~~~']) {
    await page.locator('#source-tab').click(); await page.locator('#markdown-input').fill(source);
    await exportHtml(page);
    await expect(page.locator('#export-error')).not.toBeEmpty();
    expect(await page.evaluate(() => (window as any).writes)).toBe(0);
    await expect(page.locator('#dirty-mark')).toBeVisible();
    await page.locator('#export-dialog [data-close-dialog]').last().click();
  }
});

test('HTML permits images above the Markdown limit but enforces per-image and output budgets', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const { buildHtmlDocument } = await import('/src/export-document.ts');
    const png = new Uint8Array(await (await fetch('/icons/icon-192.png')).arrayBuffer());
    const paddedPng = (size: number) => new File([png, new Uint8Array(Math.max(0, size - png.length))], 'large.png');
    const output = await buildHtmlDocument('![large](large.png)', { title: 'large', resolveImageFile: () => paddedPng(2_000_000) });
    const errors = [];
    for (const [content, size] of [['![large](large.png)', 8 * 1024 * 1024 + 1], ['![same](large.png)\n'.repeat(15), 4 * 1024 * 1024], ['![x](x.png)\n'.repeat(101), 1]] as const) {
      try { await buildHtmlDocument(content, { title: 'limit', resolveImageFile: () => paddedPng(size) }); } catch (error) { errors.push(String(error)); }
    }
    return { bytes: output.content.length, errors };
  });
  expect(result.bytes).toBeGreaterThan(2 * 1024 * 1024);
  expect(result.errors[0]).toContain('8 MB'); expect(result.errors[1]).toContain('64 MB'); expect(result.errors[2]).toContain('100個');
});

test('browser export fails closed before requesting any URL image', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const { buildHtmlDocument } = await import('/src/export-document.ts');
    const fetch = window.fetch; const requests: string[] = []; const errors: string[] = [];
    window.fetch = async input => { requests.push(String(input)); throw new Error('unexpected request'); };
    try {
      for (const url of ['https://images.example.com/pixel.png', 'http://127.0.0.1/private.png', 'http://localhost/private.png', 'http://[::1]/private.png', 'http://192.168.1.1/private.png']) {
        try { await buildHtmlDocument(`![remote](${url})`, { title: 'Remote' }); errors.push('accepted'); } catch (error) { errors.push(String(error)); }
      }
    } finally { window.fetch = fetch; }
    return { requests, errors };
  });
  expect(result.requests).toEqual([]);
  expect(result.errors).toHaveLength(5);
  expect(result.errors.every(error => error.includes('Windows版'))).toBe(true);
});

test('browser PDF prints a fully loaded snapshot without changing edit mode or dirty state', async ({ page }) => {
  await fixture(page); await page.locator('#source-tab').click();
  await page.locator('#markdown-input').fill((await page.locator('#markdown-input').inputValue()) + '\nUnsaved');
  await page.evaluate(() => {
    document.addEventListener('load', event => {
      const frame = event.target;
      if (frame instanceof HTMLIFrameElement && frame.title === 'PDF出力') frame.contentWindow!.print = () => {
        const doc = frame.contentDocument!;
        (window as any).printedPdf = { images: doc.images.length, ready: Array.from(doc.images).every(i => i.complete && i.naturalWidth > 0), controls: doc.querySelectorAll('button, textarea').length, text: doc.body.textContent };
      };
    }, true);
  });
  await page.locator('#file-menu summary').click(); await page.locator('#pdf-export-button').click(); await page.locator('#confirm-export').click();
  await expect.poll(() => page.evaluate(() => (window as any).printedPdf?.ready)).toBe(true);
  const printed = await page.evaluate(() => (window as any).printedPdf);
  expect(printed).toMatchObject({ images: 2, controls: 0 }); expect(printed.text).toContain('Unsaved');
  await expect(page.locator('#markdown-input')).toBeVisible(); await expect(page.locator('#dirty-mark')).toBeVisible();
});

test('single-file layout has a left outline and no file manager at desktop and compact widths', async ({ page }, testInfo) => {
  await fixture(page);
  for (const width of [1360, 640]) {
    await page.setViewportSize({ width, height: 900 });
    // Read both panes in the same frame: the ResizeObserver may adjust the
    // outline between separate protocol calls after a viewport resize.
    await expect.poll(() => page.evaluate(() => {
      const outline = document.querySelector('#outline')!.getBoundingClientRect();
      const body = document.querySelector('#document-scroll')!.getBoundingClientRect();
      return outline.right <= body.left + 1;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`layout-${width}.png`) });
  }
  await page.locator('#save-button').click(); await page.screenshot({ path: testInfo.outputPath('save-options.png') });
});

test('switching documents protects unsaved edits and session restores just the current file', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.locator('#source-tab').click(); await page.locator('#markdown-input').fill('# 保持する文書');
  await expect(page.locator('#document-status')).toContainText('自動保存済み');
  await page.locator('#file-input').setInputFiles({ name: 'next.md', mimeType: 'text/markdown', buffer: Buffer.from('# 次の文書') });
  await page.locator('#cancel-replace').click(); await expect(page.locator('#markdown-input')).toHaveValue('# 保持する文書');
  await page.reload(); await expect(page.locator('#markdown-input')).toHaveValue('# 保持する文書');
  await page.locator('#file-input').setInputFiles({ name: 'next.md', mimeType: 'text/markdown', buffer: Buffer.from('# 次の文書') });
  await page.locator('#discard-replace').click(); await expect(page.locator('#document-name')).toHaveText('next.md');
  await expect(page.locator('#document-status')).not.toContainText('自動保存中'); await page.reload(); await expect(page.locator('#document-name')).toHaveText('next.md');
  await expect(page.locator('#markdown-input')).toHaveValue('# 次の文書');
});

test('SVG toolbar still saves a standalone sanitized XML image', async ({ page }) => {
  await fixture(page); await page.locator('#preview [data-save-diagram]').click();
  await expect(page.locator('#editor-test-export')).toContainText('<?xml version="1.0"');
  const xml = await page.locator('#editor-test-export').textContent(); expect(xml).toContain('アイデア'); expect(xml).not.toMatch(/foreignObject|<script/);
  expect(await page.evaluate(svg => new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelector('parsererror')?.textContent, xml)).toBeUndefined();
});

test('cancelled or failed save keeps the current document when opening another file', async ({ page }) => {
  await fixture(page);
  await page.locator('#source-tab').click(); await page.locator('#markdown-input').fill('# Keep me');
  await page.evaluate(() => Object.assign(window, { showSaveFilePicker: async () => { throw new DOMException('cancelled', 'AbortError'); } }));
  await page.locator('#file-input').setInputFiles({ name: 'next.md', mimeType: 'text/markdown', buffer: Buffer.from('# Next') });
  await page.locator('#save-replace').click(); await page.locator('#confirm-save').click();
  await expect(page.locator('#save-button')).toBeEnabled(); await expect(page.locator('#document-name')).toHaveText('1.md');
  await expect(page.locator('#markdown-input')).toHaveValue('# Keep me');
  await page.evaluate(() => Object.assign(window, { showSaveFilePicker: async () => ({ createWritable: async () => { throw new Error('disk full'); } }) }));
  await page.locator('#file-input').setInputFiles({ name: 'next.md', mimeType: 'text/markdown', buffer: Buffer.from('# Next') });
  await page.locator('#save-replace').click(); await page.locator('#confirm-save').click();
  await expect(page.locator('#save-error')).toContainText('disk full');
  await page.locator('#save-dialog [data-close-dialog]').last().click();
  await expect(page.locator('#document-name')).toHaveText('1.md'); await expect(page.locator('#markdown-input')).toHaveValue('# Keep me');
});

test('legacy migration restores only the last draft and its images without deleting older data', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(async () => {
    const storage = await import('/src/storage.ts');
    const current = { id: 'legacy-current', name: 'note.md', path: 'notes/note.md', content: '# Last saved', openedAt: 1, origin: 'local' as const };
    await storage.saveWorkspaceDocuments([current, { ...current, id: 'older', name: 'older.md' }]);
    await storage.saveDraftDocument({ ...current, content: '# Last draft\n\n![image](pic.png)' });
    const blob = await (await fetch('/icons/icon-192.png')).blob();
    await storage.saveWorkspaceFile({ id: 'picture', path: 'notes/pic.png', name: 'pic.png', blob, kind: 'file', lastModified: 1 });
    storage.writePreference('lastDocument', current.id);
  });
  await page.goto('/'); await expect(page.locator('#document-name')).toHaveText('note.md');
  await page.locator('#preview-tab').click(); await expect(page.locator('#preview h1')).toHaveText('Last draft');
  await expect.poll(() => page.locator('#preview img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#dirty-mark')).toBeVisible();
  expect(await page.evaluate(async () => (await (await import('/src/storage.ts')).getWorkspaceDocuments()).length)).toBe(2);
});

test('printing waits for Mermaid rendering', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => Object.assign(window, { print: () => { (window as any).printed = { diagrams: document.querySelectorAll('#preview svg').length, pending: document.querySelectorAll('#preview .diagram-loading').length }; } }));
  await page.locator('#file-menu summary').click(); await page.locator('#print-button').click();
  await expect.poll(() => page.evaluate(() => (window as any).printed)).toEqual({ diagrams: 1, pending: 0 });
});
