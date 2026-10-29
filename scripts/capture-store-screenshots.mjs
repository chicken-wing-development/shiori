// Reproducible captures of the unmodified production desktop frontend.
// Native open/event registration is a fixture; this is not an installed-MSIX test.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const sample = await fs.readFile(path.join(root, 'store/sample/reading-notes.md'), 'utf8');
const output = path.join(root, `releases/v${pkg.version}/store/listing/screenshots`);
await fs.mkdir(output, { recursive: true });
const server = await preview({ configFile: false, root, build: { outDir: 'dist-desktop' }, preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'ja-JP', colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(content => {
    if (window.top !== window) return;
    localStorage.setItem('shiori:viewMode', '"source"');
    const callbacks = new Map();
    let sequence = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(callback) { callbacks.set(++sequence, callback); return sequence; },
      async invoke(command) {
        if (command === 'plugin:event|listen') return ++sequence;
        if (command === 'open_document') return { token: 'store-sample', name: '読書ノート.md', content };
        if (['remember_document', 'resume_document', 'close_document', 'plugin:event|unlisten'].includes(command)) return;
        throw new Error(`Unexpected native call in capture: ${command}`);
      },
    };
  }, sample);
  await page.goto('http://127.0.0.1:4175/');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await page.locator('#open-button').click();
  await expect(page.locator('#document-name')).toHaveText('読書ノート.md');
  await expect(page.locator('#preview .diagram-content svg')).toBeVisible();
  await expect(page.locator('#toast')).toBeHidden();
  await page.screenshot({ path: path.join(output, '01-markdown.png') });
  await page.locator('#preview-tab').click();
  await expect(page.locator('#source-view')).toBeHidden();
  await expect(page.locator('#preview .diagram-content svg')).toBeVisible();
  await page.screenshot({ path: path.join(output, '02-reading.png') });
  await page.locator('#wysiwyg-tab').click();
  await expect(page.locator('#rich-editor')).toBeVisible();
  await expect(page.locator('#rich-editor h1')).toHaveText('読書ノート');
  await expect(page.locator('#rich-editor')).toContainText('flowchart LR');
  await page.screenshot({ path: path.join(output, '03-wysiwyg.png') });
  await page.locator('#source-tab').click();
  await page.locator('#file-menu summary').click();
  await page.locator('#theme-button').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#preview .diagram-content svg')).toBeVisible();
  await page.screenshot({ path: path.join(output, '04-dark.png') });
  await page.locator('#version-button').click();
  await expect(page.locator('#info-about')).toContainText('shiori markdown editor 1.0.0');
  await page.screenshot({ path: path.join(root, 'test-results/store-preparation/about.png') });
  expect(errors).toEqual([]);
  await fs.writeFile(path.join(output, 'provenance.json'), JSON.stringify({
    product: 'shiori markdown editor', version: pkg.version, dimensions: [1600, 1000],
    source: 'Unmodified dist-desktop production frontend rendered in Microsoft Edge with an isolated profile.',
    nativeBridge: 'Fixture supplies the sample document and registers events. No export or native OS dialog is simulated in the listing screenshots.',
    scope: 'Frontend appearance only. Does not validate installed-MSIX startup, WebView2, native dialogs, install, update or uninstall.',
    sample: 'store/sample/reading-notes.md', imageEditing: 'None; captured directly without overlay text.', errors,
  }, null, 2) + '\n');
  console.log(`Captured 4 screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
