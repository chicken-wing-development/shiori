import type { ReaderDocument } from '../src/types';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) { if (predicate()) { await frame(); return; } await frame(); }
  throw new Error('Image persistence UI timed out');
}
async function ready(): Promise<void> { await frame(); await until(() => !$('#app').inert); }
const checks: { name: string; passed: boolean }[] = [];
const check = (name: string, passed: boolean) => checks.push({ name, passed });
const row = (path: string) => $(`[data-tree-row="${path}"]`);
const has = (path: string) => Boolean(document.querySelector(`[data-tree-row="${path}"]`));
const pictureLoaded = () => $<HTMLImageElement>('#image-preview').naturalWidth === 192;
function inputFiles(selector: string, files: File[]): void {
  const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
  $<HTMLInputElement>(selector).files = transfer.files; $(selector).dispatchEvent(new Event('change', { bubbles: true }));
}
function inFolder(file: File, path: string): File { Object.defineProperty(file, 'webkitRelativePath', { value: path }); return file; }
function reveal(path: string): void {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const element = row(parts.slice(0, i).join('/'));
    if (element.parentElement!.getAttribute('aria-expanded') === 'false') element.click();
  }
}
async function drag(source: string, destination: string): Promise<void> {
  reveal(source); reveal(`${destination}/_`);
  const transfer = new DataTransfer();
  row(source).dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  row(destination).dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  await ready();
}
function output(): void { $('#image-persistence-result').textContent = JSON.stringify({ passed: checks.every(check => check.passed), checks }, null, 2); }
const legacy: ReaderDocument = { id: 'legacy-missing-images', name: '1.md', path: '旧ワーク/1.md', content: '# 既存ワークの画像\n\n![ひとつ目](1.png)\n\n![二つ目](2.png)\n\n![ドラッグする画像](3.png)', origin: 'local', openedAt: 1 };

$('#run-image-persistence').onclick = async () => {
  $<HTMLButtonElement>('#run-image-persistence').disabled = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('shiori-reader', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('documents', 'readwrite'); tx.objectStore('documents').put(legacy);
        tx.oncomplete = () => { request.result.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
    localStorage.setItem('shiori:workspace', JSON.stringify([{ path: legacy.path, documentId: legacy.id }, ...[1, 2, 3].map(i => ({ path: `旧ワーク/${i}.png` })), { path: '旧ワーク/img', kind: 'folder' }]));
    localStorage.setItem('shiori:workspaceExpanded', JSON.stringify(['', '旧ワーク', '旧ワーク/img']));
    localStorage.setItem('shiori:lastDocument', JSON.stringify(legacy.id)); localStorage.setItem('shiori:viewMode', JSON.stringify('wysiwyg'));
    await import('../src/main');
    await until(() => Boolean(document.querySelector('#rich-view:not([aria-busy]) .rich-content')));
    const png = await (await fetch('/icons/icon-192.png')).blob();
    row('旧ワーク/1.png').click();
    check('missing legacy bytes show actionable reconnect dialog', $<HTMLDialogElement>('#missing-image-dialog').open && $('#missing-image-path').textContent === '旧ワーク/1.png');
    inputFiles('#reconnect-image-input', [new File([png], '元画像.png', { type: 'image/png' })]);
    await ready(); await until(() => $<HTMLDialogElement>('#image-dialog').open && pictureLoaded());
    check('single file reconnect preserves existing path', has('旧ワーク/1.png') && !has('元画像.png'));
    $<HTMLDialogElement>('#image-dialog').close();
    await until(() => document.querySelector<HTMLImageElement>('.rich-image img')?.naturalWidth === 192);
    check('WYSIWYG image refreshes without rebuilding work', true);

    row('旧ワーク/2.png').click();
    inputFiles('#reconnect-image-folder-input', [inFolder(new File([png], '2.png', { type: 'image/png' }), '旧ワーク/2.png')]);
    await ready(); await until(() => $<HTMLDialogElement>('#image-dialog').open && pictureLoaded());
    check('folder reconnect retains unrelated workspace entries', has('旧ワーク/1.md') && has('旧ワーク/3.png') && has('旧ワーク/1.png'));
    $<HTMLDialogElement>('#image-dialog').close();

    await drag('旧ワーク/3.png', '旧ワーク/img');
    check('missing image drag remembers intended folder', $<HTMLDialogElement>('#missing-image-dialog').open && $('#missing-image-action').textContent!.includes('旧ワーク/img'));
    inputFiles('#reconnect-image-input', [new File([png], '3.png', { type: 'image/png' })]);
    await ready(); await until(() => has('旧ワーク/img/3.png') && !has('旧ワーク/3.png'));
    check('selecting missing bytes automatically continues image move', true);
    $('#source-tab').click(); await frame();
    const markdown = $<HTMLTextAreaElement>('#markdown-input').value;
    check('resumed move updates image reference', markdown.includes('![ドラッグする画像](img/3.png)'));
    sessionStorage.setItem('image-persistence-markdown', markdown);

    inputFiles('#folder-input', [
      inFolder(new File(['# フォルダーから開く画像\n\n![表示する画像](img/shown.png)'], '1.md'), '新フォルダー/1.md'),
      inFolder(new File([png], 'shown.png', { type: 'image/png' }), '新フォルダー/img/shown.png'),
      inFolder(new File([png], 'unopened.png', { type: 'image/png' }), '新フォルダー/img/unopened.png'),
    ]);
    await ready(); await until(() => $('#document-name').textContent === '1.md' && has('新フォルダー/1.md'));
    const storage = await import('../src/storage'); const saved = await storage.getWorkspaceFiles();
    check('folder images persist before any preview or move', saved.some(record => record.kind === 'file' && record.path === '新フォルダー/img/unopened.png' && record.blob.size === png.size));
    row('旧ワーク/1.md').click(); await ready();
    $('#preview-tab').click();
    await until(() => document.querySelectorAll('#preview img').length === 3 && Array.from(document.querySelectorAll<HTMLImageElement>('#preview img')).every(image => image.naturalWidth === 192));
    check('all reconnected images remain visible', true);
    $('#reload-image-persistence').hidden = false; output();
  } catch (error) { $('#image-persistence-result').textContent = JSON.stringify({ passed: false, error: String(error), checks }, null, 2); }
};
$('#reload-image-persistence').onclick = () => { location.search = '?restore=1'; };
if (new URLSearchParams(location.search).has('restore')) {
  $('#run-image-persistence').hidden = true;
  try {
    await import('../src/main');
    await until(() => document.querySelectorAll('#preview img').length === 3 && Array.from(document.querySelectorAll<HTMLImageElement>('#preview img')).every(image => image.naturalWidth === 192));
    check('legacy reconnected images survive reload without selecting source again', true);
    $('#source-tab').click(); await frame();
    check('workspace Markdown preserved across reload', $<HTMLTextAreaElement>('#markdown-input').value === sessionStorage.getItem('image-persistence-markdown'));
    $('#preview-tab').click(); reveal('新フォルダー/img/unopened.png');
    const sourcePath = '新フォルダー/img/unopened.png';
    const targetPath = '旧ワーク/img/unopened.png';
    const imagePath = has(sourcePath) ? sourcePath : targetPath;
    reveal(imagePath); row(imagePath).click();
    await until(() => $<HTMLDialogElement>('#image-dialog').open && pictureLoaded());
    check('unopened folder image restores from saved bytes', true);
    $<HTMLDialogElement>('#image-dialog').close();
    if (imagePath === sourcePath) await drag(sourcePath, '旧ワーク/img');
    await until(() => has(targetPath) && !has(sourcePath));
    check('folder image moves after reload with no reconnect request', !$<HTMLDialogElement>('#missing-image-dialog').open);
    output();
  } catch (error) { $('#image-persistence-result').textContent = JSON.stringify({ passed: false, error: String(error), checks }, null, 2); }
}
