import { test, expect } from '@playwright/test';

async function mockDocumentBackend(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: any) => unknown>();
    const listeners = new Map<string, (event: any) => unknown>();
    let sequence = 0;
    const calls: { command: string; args: any }[] = [];
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=';
    const state = { selected: { token: 'native-A', name: 'note.md', content: '見出しに※1![読んでみよう](./img/sharp1.png)と表記します。\n\n![日本語][picture]\n\n[picture]: <img/日本語%20画像.png>\n\n![SVG](img/diagram.svg)' } as any, slow: false, committed: '', remembered: '', releases: [] as (() => void)[] };
    Object.assign(window, {
      nativeCalls: calls, nativeState: state,
      emitNativeDocument: (value: any) => listeners.get('document-opened')?.({ payload: value }),
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback: (event: any) => unknown) { callbacks.set(++sequence, callback); return sequence; },
        async invoke(command: string, args: any = {}) {
          calls.push({ command, args });
          if (command === 'plugin:event|listen') { listeners.set(args.event, callbacks.get(args.handler)!); return ++sequence; }
          if (command === 'open_document') return state.selected;
          if (command === 'remember_document') { state.remembered = args.token; return; }
          if (['resume_document', 'close_document', 'cancel_export'].includes(command)) return;
          if (command === 'read_document_image') {
            if (state.slow) await new Promise<void>(resolve => state.releases.push(resolve));
            if (args.source.includes('missing')) throw new Error('not found');
            if (args.source.endsWith('.svg')) return { name: 'diagram.svg', mime: 'image/svg+xml', data: btoa('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>window.pwned=1</script><rect width="20" height="20" fill="green"/></svg>') };
            return { name: 'sharp1.png', mime: 'image/png', data: png };
          }
          if (command === 'begin_export') return 'save-ticket';
          if (command === 'fetch_export_image') return { mime: 'image/png', data: args.source.includes('corrupt') ? btoa('not an image') : png };
          if (command === 'finish_export' || command === 'finish_pdf') { state.committed = args.content ?? args.html; return; }
          if (command === 'plugin:window|destroy') return;
          throw new Error(`Unexpected command ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
}

test('native Open resolves relative, reference-style and sanitized SVG images in both editors and saves', async ({ page }) => {
  await mockDocumentBackend(page);
  await page.locator('#open-button').click(); await expect(page.locator('#document-name')).toHaveText('note.md');
  await expect(page.locator('#rich-editor .rich-image img')).toHaveCount(3);
  await page.locator('#preview-tab').click();
  await expect(page.locator('#preview img')).toHaveCount(3);
  await expect.poll(() => page.locator('#preview img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.locator('#preview p').first()).toContainText('見出しに※1と表記します。');
  const svg = await page.locator('#preview img').last().evaluate(async image => fetch((image as HTMLImageElement).src).then(response => response.text()));
  expect(svg).not.toContain('<script');
  await exportDocument(page, 'html');
  await expect.poll(() => page.evaluate(() => (window as any).nativeState.committed)).toContain('data:image/png;base64,');
  expect(await page.evaluate(() => (window as any).nativeState.committed)).toContain('data:image/svg+xml;base64,');
  expect(await page.locator('#markdown-input').inputValue()).toContain('./img/sharp1.png');
});

test('HTML export immediately after an edit waits for referenced images before committing', async ({ page }) => {
  await mockDocumentBackend(page);
  await page.locator('#open-button').click(); await expect(page.locator('#document-name')).toHaveText('note.md');
  await expect(page.locator('#preview img')).toHaveCount(3);
  await page.locator('#source-tab').click();
  await page.evaluate(() => { (window as any).nativeState.slow = true; });
  await page.locator('#markdown-input').fill('![new](img/new.png)');
  await exportDocument(page, 'html');
  await expect.poll(() => page.evaluate(() => (window as any).nativeState.releases.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).nativeState.committed)).toBe('');
  await page.evaluate(() => { for (const release of (window as any).nativeState.releases) release(); });
  await expect.poll(() => page.evaluate(() => (window as any).nativeState.committed)).toContain('data:image/png;base64,');
});

test('native drop respects unsaved cancellation and changing documents revokes the old image scope', async ({ page }) => {
  await mockDocumentBackend(page);
  await page.locator('#open-button').click(); await expect(page.locator('#document-name')).toHaveText('note.md');
  await page.locator('#source-tab').click();
  await page.locator('#markdown-input').fill('# Unsaved\n\n![old](img/sharp1.png)');
  await page.evaluate(() => (window as any).emitNativeDocument({ token: 'native-B', name: 'second.md', content: '![second](img/sharp1.png)' }));
  await page.locator('#cancel-replace').click();
  await expect(page.locator('#document-name')).toHaveText('note.md');
  await expect.poll(() => page.evaluate(() => (window as any).nativeCalls.some((call: any) => call.command === 'close_document' && call.args.token === 'native-B'))).toBe(true);
  await page.evaluate(() => (window as any).emitNativeDocument({ token: 'native-C', name: 'note.md', content: '![new root](img/sharp1.png)' }));
  await page.locator('#discard-replace').click();
  await expect(page.locator('#preview img[alt="new root"]')).toHaveCount(1);
  await expect(page.locator('#preview img')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).nativeCalls.some((call: any) => call.command === 'read_document_image' && call.args.token === 'native-C'))).toBe(true);
  expect(await page.evaluate(() => (window as any).nativeCalls.some((call: any) => call.command === 'close_document' && call.args.token === 'native-A'))).toBe(true);
});

test('restored sessions retain their native base directory for newly added relative images', async ({ page }) => {
  await mockDocumentBackend(page);
  await page.locator('#open-button').click(); await expect(page.locator('#document-name')).toHaveText('note.md'); await expect(page.locator('#preview img')).toHaveCount(3);
  await expect(page.locator('#document-status')).not.toContainText('自動保存中');
  await page.reload(); await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#preview img')).toHaveCount(3);
  expect(await page.evaluate(() => (window as any).nativeCalls.some((call: any) => call.command === 'resume_document' && call.args.token === 'native-A'))).toBe(true);
  await page.locator('#source-tab').click(); await page.locator('#markdown-input').fill('![after restart](img/after.png)');
  await expect(page.locator('#preview img[alt="after restart"]')).toHaveCount(1);
  await expect(page.locator('#preview img')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).nativeCalls.some((call: any) => call.command === 'read_document_image' && call.args.source === 'img/after.png' && call.args.token === 'native-A'))).toBe(true);
});

test('missing relative images stop HTML export without committing partial output', async ({ page }) => {
  await mockDocumentBackend(page);
  await page.evaluate(() => { (window as any).nativeState.selected.content = '![missing](img/missing.png)'; });
  await page.locator('#open-button').click(); await expect(page.locator('#document-name')).toHaveText('note.md');
  await exportDocument(page, 'html');
  await expect(page.locator('#export-error')).toBeVisible();
  expect(await page.evaluate(() => (window as any).nativeState.committed)).toBe('');
  await expect(page.locator('#document-name')).toHaveText('note.md');
});

async function mockNativeLifecycle(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => unknown>();
    const listeners = new Map<string, (event: unknown) => unknown>();
    let sequence = 0;
    const state = { started: false, finished: false, destroyed: false };
    const openedUrls: string[] = [];
    Object.assign(window, {
      testSaveState: state,
      testOpenedUrls: openedUrls,
      requestTestClose: () => listeners.get('tauri://close-requested')?.({ event: 'tauri://close-requested', id: 1, payload: null }),
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback: (event: unknown) => unknown) { const key = ++sequence; callbacks.set(key, callback); return key; },
        async invoke(command: string, args: { event: string; handler: number; url: string }) {
          if (command === 'plugin:event|listen') { listeners.set(args.event, callbacks.get(args.handler)!); return ++sequence; }
          if (command === 'plugin:opener|open_url') { openedUrls.push(args.url); return; }
          if (command === 'begin_export') return 'ticket';
          if (command === 'finish_export' || command === 'finish_pdf') {
            state.started = true;
            await new Promise((resolve, reject) => Object.assign(window, { finishTestSave: resolve, failTestSave: () => reject(new Error('disk full')) }));
            state.finished = true; return;
          }
          if (command === 'cancel_export') return;
          if (command === 'plugin:window|destroy') { state.destroyed = true; return; }
          if (command === 'plugin:dialog|message') return false;
          throw new Error(`Unexpected command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
}

test('closing waits for the file commit before destroying the window', async ({ page }) => {
  await mockNativeLifecycle(page);
  await page.locator('#save-button').click();
  await page.locator('#confirm-save').click();
  await page.waitForFunction(() => (window as any).testSaveState.started);
  await page.evaluate(() => { (window as any).closingTest = (window as any).requestTestClose(); });
  expect(await page.evaluate(() => (window as any).testSaveState.destroyed)).toBe(false);
  await page.evaluate(async () => { (window as any).finishTestSave(); await (window as any).closingTest; });
  expect(await page.evaluate(() => (window as any).testSaveState)).toEqual({ started: true, finished: true, destroyed: true });
});

test('desktop keeps document links inside the editor and opens only external URLs', async ({ page }) => {
  await mockNativeLifecycle(page);
  await page.locator('#file-input').setInputFiles({ name: 'links.md', mimeType: 'text/markdown', buffer: Buffer.from('# Start\n\n' + 'Paragraph\n\n'.repeat(30) + '## Target') });
  await page.locator('#preview-tab').click();
  await page.locator('#outline-list a').nth(1).click();
  await expect.poll(() => page.locator('#document-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.locator('#source-tab').click();
  await page.locator('#markdown-input').fill('# Links\n\n[Jump](#target)\n\n[Local](reference.md)\n\n[External](https://example.com/)\n\n[Mail](mailto:reader@example.com)\n\n## Target\n');
  await page.locator('#preview-tab').click();
  await page.locator('#preview a').filter({ hasText: /^Jump$/ }).click();
  await page.locator('#preview a').filter({ hasText: /^Local$/ }).click();
  await expect(page.locator('#toast')).toContainText('別の文書は');
  await page.locator('#preview a').filter({ hasText: /^External$/ }).click();
  await page.locator('#preview a').filter({ hasText: /^Mail$/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testOpenedUrls)).toEqual(['https://example.com/', 'mailto:reader@example.com']);
});

test('a save failure during close keeps the editor open and enables retry', async ({ page }) => {
  await mockNativeLifecycle(page);
  await page.locator('#save-button').click();
  await page.locator('#confirm-save').click();
  await page.waitForFunction(() => (window as any).testSaveState.started);
  await page.evaluate(() => { (window as any).closingTest = (window as any).requestTestClose(); });
  await page.evaluate(async () => { (window as any).failTestSave(); await (window as any).closingTest; });
  expect(await page.evaluate(() => (window as any).testSaveState.destroyed)).toBe(false);
  expect(await page.locator('#app').evaluate(el => el.inert)).toBe(false);
  await expect(page.locator('#save-button')).toBeEnabled();
  await page.evaluate(() => { (window as any).testSaveState.started = false; });
  await page.locator('#confirm-save').click();
  await page.waitForFunction(() => (window as any).testSaveState.started);
  await page.evaluate(() => (window as any).finishTestSave());
  await expect(page.locator('#save-button')).toBeEnabled();
});

test('closing also waits while a Markdown export is still generating content', async ({ page }) => {
  await mockNativeLifecycle(page);
  await page.evaluate(async () => {
    const { exportTextFile } = await import('/src/save-file.ts');
    (window as any).exportTest = exportTextFile({ name: 'slow.md', description: 'Markdown', mime: 'text/markdown', extensions: ['.md'], content: () => new Promise(resolve => { (window as any).finishTestRender = () => resolve('# Saved'); }) });
  });
  await page.waitForFunction(() => typeof (window as any).finishTestRender === 'function');
  await page.evaluate(() => { (window as any).closingTest = (window as any).requestTestClose(); });
  expect(await page.evaluate(() => (window as any).testSaveState.destroyed)).toBe(false);
  await page.evaluate(() => (window as any).finishTestRender());
  await page.waitForFunction(() => (window as any).testSaveState.started);
  await page.evaluate(async () => { (window as any).finishTestSave(); await (window as any).closingTest; });
  expect(await page.evaluate(() => (window as any).testSaveState.destroyed)).toBe(true);
});

test('desktop uses native Save As for SVG/Markdown and does not write after cancellation', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const calls: { command: string; args: unknown }[] = [];
    let cancel = false;
    Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string, args: unknown) => {
      calls.push({ command, args });
      if (command === 'begin_export') return cancel ? null : 'opaque-save-ticket';
      if (command === 'finish_export' || command === 'cancel_export') return;
      throw new Error(`Unexpected native call: ${command}`);
    } } });
    const { exportMarkdown, exportTextFile } = await import('/src/save-file.ts');
    const saved = await exportMarkdown('日本語.md', '# Native');
    await exportTextFile({ name: 'figure.svg', description: 'SVG', mime: 'image/svg+xml', extensions: ['.svg'], content: '<svg />' });
    cancel = true;
    const cancelled = await exportMarkdown('cancel.md', 'must not write');
    return { calls, saved, cancelled };
  });
  expect(result.saved).toBe('saved');
  expect(result.cancelled).toBe('cancelled');
  expect(result.calls.filter(call => call.command === 'begin_export')).toHaveLength(3);
  expect(result.calls.filter(call => call.command === 'finish_export')).toHaveLength(2);
  expect(result.calls.filter(call => call.command === 'cancel_export')).toHaveLength(2);
});

test('desktop shows its own version and no PWA installation or service worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#version-button')).toHaveText('v1.0.0 Desktop');
  await expect(page.locator('#install-button')).toBeHidden();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('edits made during save are retained before switching to another document', async ({ page }) => {
  await mockNativeLifecycle(page);
  await page.locator('#source-tab').click(); await page.locator('#markdown-input').fill('# First edit');
  await page.locator('#file-input').setInputFiles({ name: 'next.md', mimeType: 'text/markdown', buffer: Buffer.from('# Next') });
  await page.locator('#save-replace').click(); await page.locator('#confirm-save').click();
  await page.waitForFunction(() => (window as any).testSaveState.started);
  await page.locator('#markdown-input').fill('# Newer unsaved edit');
  await page.evaluate(() => (window as any).finishTestSave());
  await expect(page.locator('#save-button')).toBeEnabled();
  await expect(page.locator('#document-name')).not.toHaveText('next.md');
  await expect(page.locator('#markdown-input')).toHaveValue('# Newer unsaved edit');
  await expect(page.locator('#dirty-mark')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('保存中に加わった変更');
});


async function exportDocument(page: import('@playwright/test').Page, format: 'html' | 'pdf') {
  await page.locator('#file-menu summary').click(); await page.locator('#' + format + '-export-button').click(); await page.locator('#confirm-export').click();
}

test('native remote image export uses the Rust command instead of browser networking', async ({ page }) => {
  await mockDocumentBackend(page); await page.locator('#source-tab').click();
  await page.locator('#markdown-input').fill('![remote](https://images.example.com/pixel.png)');
  const requests: string[] = []; page.on('request', request => { if (request.url().startsWith('https://images.example.com')) requests.push(request.url()); });
  await exportDocument(page, 'html');
  await expect.poll(() => page.evaluate(() => (window as any).nativeState.committed)).toContain('data:image/png;base64,');
  expect(await page.evaluate(() => (window as any).nativeCalls.filter((call: any) => call.command === 'fetch_export_image').map((call: any) => call.args.source))).toEqual(['https://images.example.com/pixel.png']);
  expect(requests).toEqual([]);
});

for (const format of ['html', 'pdf'] as const) {
  test(`native ${format} rejects corrupt remote images before committing and preserves edits`, async ({ page }) => {
    await mockDocumentBackend(page); await page.locator('#source-tab').click();
    const content = '![broken](https://images.example.com/corrupt.png)';
    await page.locator('#markdown-input').fill(content); await exportDocument(page, format);
    await expect(page.locator('#export-error')).toContainText('画像のデータが不正');
    expect(await page.evaluate(() => (window as any).nativeState.committed)).toBe('');
    expect(await page.evaluate(() => (window as any).nativeCalls.filter((call: any) => ['finish_export', 'finish_pdf'].includes(call.command)))).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).nativeCalls.some((call: any) => call.command === 'cancel_export'))).toBe(true);
    await expect(page.locator('#markdown-input')).toHaveValue(content); await expect(page.locator('#dirty-mark')).toBeVisible();
  });
}

test('native PDF uses an inert HTML snapshot with all images and keeps Markdown dirty', async ({ page }) => {
  await mockDocumentBackend(page); await page.locator('#open-button').click(); await expect(page.locator('#document-name')).toHaveText('note.md'); await page.locator('#source-tab').click();
  const source = (await page.locator('#markdown-input').inputValue()) + '\n\n~~~mermaid\nflowchart LR\n A --> B\n~~~\n';
  await page.locator('#markdown-input').fill(source); await exportDocument(page, 'pdf');
  await expect.poll(() => page.evaluate(() => (window as any).nativeState.committed)).toContain('data:image/svg+xml;base64,');
  const calls = await page.evaluate(() => (window as any).nativeCalls);
  expect(calls.find((c: any) => c.command === 'begin_export').args.kind).toBe('pdf');
  expect(calls.some((c: any) => c.command === 'finish_pdf')).toBe(true);
  expect(calls.some((c: any) => c.command === 'finish_export')).toBe(false);
  await expect(page.locator('#dirty-mark')).toBeVisible(); await expect(page.locator('#markdown-input')).toHaveValue(source);
});

test('close waits for PDF generation and failed PDF leaves the editor usable', async ({ page }) => {
  await mockNativeLifecycle(page); await exportDocument(page, 'pdf');
  await page.waitForFunction(() => (window as any).testSaveState.started);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-dialog')).not.toBeVisible();
  await page.evaluate(() => { (window as any).closingTest = (window as any).requestTestClose(); });
  expect(await page.evaluate(() => (window as any).testSaveState.destroyed)).toBe(false);
  await page.evaluate(async () => { (window as any).failTestSave(); await (window as any).closingTest; });
  expect(await page.evaluate(() => (window as any).testSaveState.destroyed)).toBe(false);
  await expect(page.locator('#export-error')).toContainText('disk full');
  expect(await page.locator('#app').evaluate(el => el.inert)).toBe(false);
  await page.evaluate(() => { (window as any).testSaveState.started = false; });
  await page.locator('#confirm-export').click(); await page.waitForFunction(() => (window as any).testSaveState.started);
  await page.evaluate(() => { (window as any).closingTest = (window as any).requestTestClose(); });
  await page.evaluate(async () => { (window as any).finishTestSave(); await (window as any).closingTest; });
  expect(await page.evaluate(() => (window as any).testSaveState.destroyed)).toBe(true);
});

test('PDF destination cancellation does not generate or write a document', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const calls: string[] = []; let generated = false;
    Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string) => { calls.push(cmd); if (cmd === 'begin_export') return null; throw Error(cmd); } } });
    const result = await (await import('/src/save-file.ts')).exportPdfFile('test.pdf', async () => { generated = true; return '<html/>'; });
    return { result, calls, generated };
  });
  expect(result).toEqual({ result: 'cancelled', calls: ['begin_export'], generated: false });
});
