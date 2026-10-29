import { test, expect } from '@playwright/test';

test('exported network-path links stay HTTPS when opened as a local HTML file', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const { buildHtmlDocument } = await import('/src/export-document.ts');
    const output = await buildHtmlDocument('[network](//example.com/share)\n\n[reference][r]\n\n[r]: //example.com/日本語\n\n[triple](///example.com/share)\n\n[local](./other.md)\n\n[anchor](#section)\n\n[blocked](file://host/share)', { title: 'Links' });
    const doc = new DOMParser().parseFromString(output.content, 'text/html');
    return Array.from(doc.querySelectorAll('a'), a => ({ text: a.textContent, url: new URL(a.getAttribute('href')!, 'file:///C:/exports/doc.html').href, target: a.target, rel: a.rel }));
  });
  for (const link of result.slice(0, 3)) { expect(link.url).toMatch(/^https:\/\/example\.com\//); expect(link.target).toBe('_blank'); expect(link.rel).toContain('noopener'); expect(link.rel).toContain('noreferrer'); }
  expect(result[3].url).toBe('file:///C:/exports/other.md');
  expect(result[4].url).toBe('file:///C:/exports/doc.html#section');
  expect(result).toHaveLength(5);
});

test('export rejects corrupt, truncated and mislabeled raster images from files and data URLs', async ({ page }) => {
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const { buildHtmlDocument } = await import('/src/export-document.ts');
    const png = new Uint8Array(await (await fetch('/icons/icon-192.png')).arrayBuffer());
    const samples = [new TextEncoder().encode('not an image'), png.slice(0, 24)];
    const errors: string[] = [];
    for (const bytes of samples) {
      for (const embedded of [false, true]) {
        const path = embedded ? `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}` : 'bad.png';
        try { await buildHtmlDocument(`![bad](${path})`, { title: 'Bad image', resolveImageFile: () => new File([bytes], 'bad.png') }); errors.push('accepted'); } catch (error) { errors.push(String(error)); }
      }
    }
    try { await buildHtmlDocument('![wrong](wrong.gif)', { title: 'Wrong type', resolveImageFile: () => new File([png], 'wrong.gif') }); errors.push('accepted'); } catch (error) { errors.push(String(error)); }
    const valid = await buildHtmlDocument('![ok](valid.png)', { title: 'Valid', resolveImageFile: () => new File([png], 'valid.png') });
    return { errors, images: valid.images };
  });
  expect(result.errors).toHaveLength(5);
  expect(result.errors.every(error => error.includes('画像のデータが不正'))).toBe(true);
  expect(result.images).toBe(1);
});

test('Mermaid cannot request images or CSS resources, including escaped metadata', async ({ page, context }) => {
  const requested: string[] = [];
  await context.route('https://security.invalid/**', route => { requested.push(route.request().url()); return route.abort(); });
  await page.goto('/tests/export-fixture.html'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const { buildHtmlDocument } = await import('/src/export-document.ts');
    const sources = [
      'flowchart LR\n A@{img: "https://security.invalid/image.png", h:40}',
      'flowchart LR\n A@{"i\\u006dg": "https://security.invalid/escaped.png", h:40}',
      'flowchart LR\n A[Test]\n style A fill:url(https://security.invalid/style.svg)',
    ];
    const output = [];
    for (const source of sources) { try { output.push(await buildHtmlDocument(`\x60\x60\x60mermaid\n${source}\n\x60\x60\x60`, { title: 'Security' })); } catch (error) { output.push({ error: String(error) }); } }
    const good = await buildHtmlDocument('```mermaid\nflowchart LR\n A[日本語] --> B[安全]\n```', { title: 'Security' });
    return { warnings: output[0].error ?? '', unsafeOutput: output.some(doc => /<(?:image|img)[^>]+https:/.test(doc.content ?? '')), good: good.diagrams };
  });
  expect(requested).toEqual([]);
  expect(result.warnings).not.toHaveLength(0);
  expect(result.unsafeOutput).toBe(false);
  expect(result.good).toBe(1);
  await expect(page.locator('iframe[title="Mermaid renderer"]')).toHaveAttribute('sandbox', 'allow-scripts');
  const renderer = page.frames().find(frame => frame.url().startsWith('blob:'))!;
  const boundary = await renderer.evaluate(async () => {
    let parentDenied = false; let networkDenied = false;
    try { void parent.document.body; } catch { parentDenied = true; }
    try { await fetch('https://security.invalid/fetch'); } catch { networkDenied = true; }
    const imageDenied = await new Promise(resolve => { const img = new Image(); img.onload = () => resolve(false); img.onerror = () => resolve(true); img.src = 'https://security.invalid/backstop.png'; });
    return { parentDenied, networkDenied, imageDenied, ipcAvailable: '__TAURI_INTERNALS__' in window };
  });
  expect(boundary).toEqual({ parentDenied: true, networkDenied: true, imageDenied: true, ipcAvailable: false });
  expect(requested).toEqual([]);
});

test('source edits reject oversized UTF-8 content without changing the saved draft', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.locator('#source-tab').click();
  await page.locator('#markdown-input').fill('# 保持する本文');
  await page.locator('#markdown-input').fill('a'.repeat(2 * 1024 * 1024 + 1));
  await expect(page.locator('#markdown-input')).toHaveValue('# 保持する本文');
  await expect(page.locator('#toast')).toContainText('2 MB');
  const drafts = await page.evaluate(async () => [(await (await import('/src/storage.ts')).loadEditorSession())?.document.content]);
  expect(drafts).toEqual(['# 保持する本文']);
});

test('rich editor rejects oversized paste and remains editable', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.locator('#wysiwyg-tab').click();
  const editor = page.getByRole('textbox', { name: 'WYSIWYG編集', exact: true });
  await editor.fill('保持する本文');
  await editor.fill('あ'.repeat(700_000));
  await expect(editor).toHaveText('保持する本文');
  await expect(page.locator('#toast')).toContainText('2 MB');
  await editor.fill('編集を継続');
  await page.locator('#source-tab').click();
  await expect(page.locator('#markdown-input')).toHaveValue(/編集を継続/);
});

test('embedded SVG is sanitized before preview, rich editing and re-export', async ({ page, context }) => {
  const requests: string[] = [];
  await context.route('https://security.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/'); await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" onload="alert(1)"><script>alert(1)</script><image href="https://security.invalid/image.png"/><style>@import url(https://security.invalid/style.css);</style><foreignObject><p>unsafe</p></foreignObject><rect width="50" height="50" fill="green"/></svg>';
  const content = `![safe](data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')})`;
  await page.locator('#file-input').setInputFiles({ name: 'svg.md', mimeType: 'text/markdown', buffer: Buffer.from(content) });
  await page.locator('#preview-tab').click();
  const decoded = await page.locator('#preview img').evaluate((image: HTMLImageElement) => atob(image.src.split(',')[1]));
  expect(decoded).toContain('<rect'); expect(decoded).not.toMatch(/onload|script|foreignObject|<image|security\.invalid/);
  await page.locator('#wysiwyg-tab').click(); await expect(page.locator('#rich-editor .rich-image img')).toHaveCount(1);
  const rich = await page.locator('#rich-editor .rich-image img').evaluate((image: HTMLImageElement) => atob(image.src.split(',')[1]));
  expect(rich).not.toMatch(/onload|script|foreignObject|<image|security\.invalid/);
  const exported = await page.evaluate(async content => (await import('/src/export-document.ts')).buildHtmlDocument(content, { title: 'Security' }), content);
  const outputSvg = Buffer.from(exported.content.match(/base64,([^" ]*)/)![1], 'base64').toString('utf8');
  expect(outputSvg).not.toMatch(/onload|script|foreignObject|<image|security\.invalid/); expect(requests).toEqual([]);
});
