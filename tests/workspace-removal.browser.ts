import type { ReaderDocument } from '../src/types';
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 600; i++) { if (predicate()) { await frame(); return; } await frame(); }
  throw new Error('UI operation timed out');
}
async function ready(): Promise<void> { await frame(); await until(() => !$('#app').inert); }
const row = (path: string) => $(`[data-tree-row="${path}"]`);
const has = (path: string) => Boolean(document.querySelector(`[data-tree-row="${path}"]`));
const checks: { name: string; passed: boolean }[] = [];
function check(name: string, passed: boolean): void { checks.push({ name, passed }); if (!passed) throw new Error(name); }
function output(error?: unknown): void { $('#removal-result').textContent = JSON.stringify({ passed: !error && checks.every(check => check.passed), ...(error ? { error: String(error) } : {}), checks }, null, 2); }
function reveal(path: string): void {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const element = row(parts.slice(0, i).join('/'));
    if (element.parentElement!.getAttribute('aria-expanded') === 'false') element.click();
  }
}
function requestRemoval(path: string): void { reveal(path); row(path).querySelector<HTMLButtonElement>('[data-remove-tree]')!.click(); }
async function confirmRemoval(path: string): Promise<void> {
  check(`confirm exact removal path ${path}`, $<HTMLDialogElement>('#remove-dialog').open && $('#remove-path').textContent === path);
  $('#confirm-remove').click();
  await until(() => !$<HTMLDialogElement>('#remove-dialog').open); await ready();
  check(`removed ${path}`, !has(path));
}
async function drop(parent: string, files: File[]): Promise<void> {
  reveal(`${parent}/_`);
  const transfer = new DataTransfer(); for (const file of files) transfer.items.add(file);
  row(parent).dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  await ready();
}
async function records(database: string, store: string, seed?: unknown[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, seed ? 'readwrite' : 'readonly');
      if (seed) for (const value of seed) tx.objectStore(store).put(value);
      const all = tx.objectStore(store).getAll();
      tx.oncomplete = () => { db.close(); resolve(all.result); }; tx.onerror = () => reject(tx.error);
    };
  });
}
async function markdown(): Promise<string> { $('#source-tab').click(); await frame(); return $<HTMLTextAreaElement>('#markdown-input').value; }
const makeDocument = (id: string, path: string, content: string, openedAt: number): ReaderDocument => ({ id, path, name: path.split('/').at(-1)!, content, openedAt, origin: 'local' });
const original = makeDocument('remove-old-copy', 'A/文書.md', '# 元の文章', 1);
const edited = makeDocument('remove-edited', 'A/文書.md', '# 削除する下書き', 10);
const keeper = makeDocument('keep-document', 'AB/文書.md', '# 残す文書\n\n![残る図](../残す画像.png)\n\n![削除する図](../A/img/1.png)\n\n編集した本文はそのまま', 5);

$('#run-removal').onclick = async () => {
  $<HTMLButtonElement>('#run-removal').disabled = true;
  try {
    await records('shiori-reader', 'documents', [original, edited, keeper]);
    await records('shiori-reader-workspace', 'workspace-documents', [original, edited, keeper]);
    await records('shiori-reader-drafts', 'drafts', [edited, keeper]);
    await records('shiori-reader-files', 'files', [{ id: `document:${edited.id}`, path: edited.path, kind: 'document', document: edited }, { id: 'folder:A/img', path: 'A/img', kind: 'folder' }]);
    localStorage.setItem('shiori:workspace', JSON.stringify([{ path: edited.path, documentId: edited.id }, { path: keeper.path, documentId: keeper.id }, { path: '不足.png' }]));
    localStorage.setItem('shiori:workspaceExpanded', JSON.stringify(['', 'A', 'A/img', 'AB']));
    localStorage.setItem('shiori:lastDocument', JSON.stringify(edited.id));
    localStorage.setItem('shiori:viewMode', JSON.stringify('source'));
    await import('../src/main');
    check('restored edited document before deletion', await markdown() === edited.content);
    requestRemoval(edited.path!);
    check('cancel is focused and current draft remains untouched', document.activeElement?.id === 'cancel-remove' && $<HTMLTextAreaElement>('#markdown-input').value === edited.content);
    $('#cancel-remove').click(); await frame();
    check('cancel preserves target and other workspace entries', has(edited.path!) && has(keeper.path!) && !$<HTMLDialogElement>('#remove-dialog').open);
    $<HTMLTextAreaElement>('#markdown-input').value += '\n\n削除直前の入力'; $('#markdown-input').dispatchEvent(new Event('input'));
    requestRemoval(edited.path!); await confirmRemoval(edited.path!);
    check('deleting current document switches to remaining document', await markdown() === keeper.content && has('A') && has(keeper.path!));
    for (const [db, store] of [['shiori-reader', 'documents'], ['shiori-reader-workspace', 'workspace-documents'], ['shiori-reader-drafts', 'drafts']]) {
      const saved = await records(db, store);
      check(`all old copies removed from ${store}`, !saved.some(doc => [original.id, edited.id].includes(doc.id)) && saved.some(doc => doc.id === keeper.id));
    }
    const png = await (await fetch('/icons/icon-192.png')).blob();
    await drop('', [new File([png], '残す画像.png', { type: 'image/png' })]);
    await drop('A/img', [new File([png], '1.png', { type: 'image/png' }), new File([png], '2.png', { type: 'image/png' }), new File(['添付'], '添付.bin')]);
    row('A/img/1.png').click(); await until(() => $<HTMLDialogElement>('#image-dialog').open);
    $('#delete-image').click(); $('#cancel-remove').click(); await frame();
    check('cancel from image preview keeps image and preview open', has('A/img/1.png') && $<HTMLDialogElement>('#image-dialog').open);
    $('#delete-image').click(); await confirmRemoval('A/img/1.png');
    check('image deletion closes preview and leaves Markdown intact', !$<HTMLDialogElement>('#image-dialog').open && await markdown() === keeper.content);
    const item = row('A/img/添付.bin').parentElement!; item.focus();
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    await confirmRemoval('A/img/添付.bin');
    requestRemoval('不足.png');
    check('missing image can be deleted without reconnecting bytes', !$<HTMLDialogElement>('#missing-image-dialog').open);
    await confirmRemoval('不足.png');
    $('#create-folder').click(); $<HTMLSelectElement>('#folder-parent').value = ''; $<HTMLInputElement>('#folder-name').value = '空フォルダー';
    $('#folder-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !$<HTMLDialogElement>('#folder-dialog').open); await ready();
    requestRemoval('空フォルダー'); check('empty folder confirmation reports zero files', $('#remove-summary').textContent!.includes('0件')); await confirmRemoval('空フォルダー');
    requestRemoval('A'); check('folder confirmation includes descendant count', $('#remove-summary').textContent!.includes('1件')); await confirmRemoval('A');
    check('folder deletion preserves similar prefix and other image', has(keeper.path!) && has('残す画像.png') && !has('A/img/2.png'));
    const imported = new File(['# 再追加した文書'], '文書.md', { type: 'text/markdown' });
    Object.defineProperty(imported, 'webkitRelativePath', { value: 'A/文書.md' });
    const transfer = new DataTransfer(); transfer.items.add(imported);
    $<HTMLInputElement>('#file-input').files = transfer.files; $('#file-input').dispatchEvent(new Event('change'));
    await ready();
    check('deleted filename can be added again as a new document', has('A/文書.md') && await markdown() === '# 再追加した文書');
    requestRemoval('A/文書.md'); await confirmRemoval('A/文書.md');
    check('removing last child retains imported parent folder', has('A'));
    requestRemoval('A'); await confirmRemoval('A');
    check('original provided File object was not changed', await imported.text() === '# 再追加した文書');
    sessionStorage.setItem('removal-expected', keeper.content);
    $('#preview-tab').click(); await until(() => Boolean(document.querySelector<HTMLImageElement>('#preview img')?.naturalWidth));
    const files = await records('shiori-reader-files', 'files');
    check('removed canonical files and blobs are absent', !files.some(file => file.path === 'A' || file.path.startsWith('A/')) && files.some(file => file.path === '残す画像.png'));
    check('workspace root has no delete action', !row('').querySelector('[data-remove-tree]'));
    $('#reload-removal').hidden = false; output();
  } catch (error) { output(error); }
};
$('#reload-removal').onclick = () => { location.search = '?restore=1'; };
if (new URLSearchParams(location.search).has('restore')) {
  $('#run-removal').hidden = true;
  try {
    await import('../src/main');
    check('deleted files, draft and folders do not return after reload', !has('A') && !has('不足.png') && !has('空フォルダー'));
    check('unrelated body and draft survive reload unchanged', has(keeper.path!) && await markdown() === sessionStorage.getItem('removal-expected'));
    $('#preview-tab').click(); await until(() => Boolean(document.querySelector<HTMLImageElement>('#preview img')?.naturalWidth));
    check('unrelated image blob still renders after reload', has('残す画像.png') && document.querySelector<HTMLImageElement>('#preview img')!.naturalWidth === 192);
    output();
  } catch (error) { output(error); }
}
export {};
