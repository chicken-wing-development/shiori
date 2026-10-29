import { chromium } from '@playwright/test';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const directory = path.resolve('test-results/export-security-fix/native');
const native = JSON.parse(await readFile(path.join(directory, 'webview2-results.json'), 'utf8'));
assert.equal(native.results.length, 9);
assert(native.results.every(result => result.passed));
assert.equal(JSON.parse(await readFile(path.join(directory, 'network.json'), 'utf8')).received, 0);
for (const file of ['invalid-html.html', 'invalid-pdf.pdf']) {
  assert.equal(await access(path.join(directory, file)).then(() => true, () => false), false, `${file} must not exist`);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ offline: true }); const page = await context.newPage();
  const network = []; page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.goto(pathToFileURL(path.join(directory, 'valid-html.html')).href);
  const result = await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, image => image.decode()));
    return { images: document.images.length, allDecoded: Array.from(document.images).every(image => image.naturalWidth > 0), scripts: document.scripts.length, link: document.querySelector('a')?.href };
  });
  assert.deepEqual(result, { images: 2, allDecoded: true, scripts: 0, link: 'https://example.com/document' });
  assert.deepEqual(network, []);
  await page.screenshot({ path: path.join(directory, 'offline-html.png'), fullPage: true });
  await writeFile(path.join(directory, 'output-verification.json'), JSON.stringify({ nativeChecks: native.results.length, rejectedFilesAbsent: true, internalRequests: 0, html: { ...result, network } }, null, 2));
  console.log(JSON.stringify({ nativeChecks: native.results.length, html: result, internalRequests: 0 }));
} finally { await browser.close(); }
