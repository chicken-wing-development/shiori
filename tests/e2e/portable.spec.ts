import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

test('single HTML app opens via file URL offline and downloads a self-contained document', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('portable/shiori.html')).href);
  await expect(page.locator('#install-button')).toBeHidden();
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const source = '# Portable export\n\n```mermaid\nflowchart LR\n A[Offline] --> B[SVG]\n```';
  const md = testInfo.outputPath('portable-note.md');
  await writeFile(md, source);
  await page.locator('#file-input').setInputFiles(md);
  await expect(page.locator('#document-name')).toHaveText('portable-note.md');
  const downloading = page.waitForEvent('download');
  await page.locator('#file-menu summary').click();
  await page.locator('#html-export-button').click();
  await page.locator('#confirm-export').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('portable-note.html');
  const file = testInfo.outputPath('portable-note.html');
  await download.saveAs(file);
  const html = await readFile(file, 'utf8');
  expect(html).toContain('data:image/svg+xml;base64,');
  expect(html).not.toContain('flowchart');
  expect(html).not.toMatch(/<script|blob:/);
  expect(errors).toEqual([]);
});

test('portable PDF prepares an offline print document under the production CSP', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('portable/shiori.html')).href);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.locator('#file-input').setInputFiles({ name: 'pdf.md', mimeType: 'text/markdown', buffer: Buffer.from('# 日本語PDF\n\n~~~mermaid\nflowchart LR\n A[日本語] --> B[PDF]\n~~~') });
  await expect(page.locator('#document-name')).toHaveText('pdf.md');
  await page.evaluate(() => {
    document.addEventListener('load', event => {
      const frame=event.target;
      if (frame instanceof HTMLIFrameElement && frame.title === 'PDF出力') frame.contentWindow!.print = () => {
        const doc=frame.contentDocument!;
        (window as any).printedPdf={images:doc.images.length,ready:Array.from(doc.images).every(i=>i.naturalWidth>0),text:doc.body.textContent};
      };
    },true);
  });
  await page.locator('#file-menu summary').click(); await page.locator('#pdf-export-button').click(); await page.locator('#confirm-export').click();
  await expect.poll(() => page.evaluate(() => (window as any).printedPdf?.ready)).toBe(true);
  expect(await page.evaluate(() => (window as any).printedPdf)).toMatchObject({images:1,ready:true});
  await expect(page.locator('#toast')).toContainText('PDFに保存');
});
