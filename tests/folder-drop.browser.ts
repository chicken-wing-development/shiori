await import('../src/main');
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) { if (predicate()) { await frame(); return; } await frame(); }
  throw new Error('UI operation timed out');
}
const checks: { name: string; passed: boolean }[] = [];
const check = (name: string, passed: boolean) => checks.push({ name, passed });
const row = (path: string) => $(`[data-tree-row="${path}"]`);
const present = (path: string) => Boolean(document.querySelector(`[data-tree-row="${path}"]`));
async function ready(): Promise<void> { await frame(); await waitFor(() => !$('#app').inert); }
async function folder(name: string, parent = ''): Promise<void> {
  $('#create-folder').click(); $<HTMLSelectElement>('#folder-parent').value = parent; $<HTMLInputElement>('#folder-name').value = name;
  $('#folder-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !$<HTMLDialogElement>('#folder-dialog').open); await ready();
}
async function externalDrop(path: string, files: File[]): Promise<void> {
  const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
  row(path).dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  await ready();
}
async function move(from: string, to: string): Promise<void> {
  const transfer = new DataTransfer();
  row(from).dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  row(to).dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  check(`drop target ${to}`, row(to).classList.contains('drop-target') && $('#drop-overlay').hidden);
  row(to).dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  await ready(); await waitFor(() => !present(from));
}
async function open(path: string): Promise<void> {
  row(path).click(); await waitFor(() => $('#document-name').textContent === path.split('/').at(-1));
}
async function source(): Promise<string> { $('#source-tab').click(); await frame(); return $<HTMLTextAreaElement>('#markdown-input').value; }
function output(): void { $('#folder-regression-result').textContent = JSON.stringify({ passed: checks.every(result => result.passed), checks }, null, 2); }

$('#run-folder-regression').onclick = async () => {
  $<HTMLButtonElement>('#run-folder-regression').disabled = true;
  try {
    await folder('プロジェクトA'); await folder('img', 'プロジェクトA'); await folder('空フォルダー');
    check('empty folder created', present('空フォルダー'));
    const png = await (await fetch('/icons/icon-192.png')).blob();
    const image = new File([png], '1.png', { type: 'image/png' });
    await externalDrop('', [image, new File(['# フォルダーと画像\n\n![図](1.png)\n\n```md\n![例](1.png)\n```'], '1.md', { type: 'text/markdown' })]);
    await waitFor(() => present('1.png') && present('1.md'));
    check('original image row is draggable', row('1.png').draggable);
    await move('1.png', 'プロジェクトA/img');
    check('image moved into nested folder', present('プロジェクトA/img/1.png'));
    let text = await source();
    check('image reference follows file move, code stays intact', text.includes('![図](%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88A/img/1.png)') && text.includes('![例](1.png)'));
    $('#preview-tab').click(); await waitFor(() => Boolean(document.querySelector<HTMLImageElement>('#preview img')?.naturalWidth));
    check('moved image still renders', document.querySelector<HTMLImageElement>('#preview img')!.naturalWidth === 192);
    await externalDrop('プロジェクトA/img', [image]);
    check('same-name file kept separately', present('プロジェクトA/img/1 (2).png'));
    await move('1.md', 'プロジェクトA');
    text = await source();
    check('Markdown move rebases its images', text.includes('![図](img/1.png)'));
    check('Markdown document moved and root removed', present('プロジェクトA/1.md') && !present('1.md'));
    $('#preview-tab').click(); await waitFor(() => Boolean(document.querySelector<HTMLImageElement>('#preview img')?.naturalWidth));
    await move('プロジェクトA/img/1 (2).png', '');
    check('moving back to root works', present('1 (2).png'));
    row('プロジェクトA').click(); if (!present('プロジェクトA/img')) row('プロジェクトA').click();
    $('#new-document').click(); await waitFor(() => present('プロジェクトA/無題.md'));
    check('new document uses selected folder', present('プロジェクトA/無題.md'));
    await open('プロジェクトA/1.md');
    text = await source(); sessionStorage.setItem('folder-move-expected', text);
    $<HTMLTextAreaElement>('#markdown-input').value = text + '\n\n移動後に編集した文章';
    $('#markdown-input').dispatchEvent(new Event('input')); await frame(); await frame();
    sessionStorage.setItem('folder-move-expected', text + '\n\n移動後に編集した文章');
    $('#preview-tab').click(); await ready();
    $('#reload-folder-regression').hidden = false; output();
  } catch (error) { $('#folder-regression-result').textContent = JSON.stringify({ passed: false, error: String(error), checks }, null, 2); }
};
$('#reload-folder-regression').onclick = () => { location.search = '?restore=1'; };
if (new URLSearchParams(location.search).has('restore')) {
  $('#run-folder-regression').hidden = true;
  try {
    check('empty folder survives reload', present('空フォルダー'));
    check('moved paths survive reload without resurrecting old paths', present('プロジェクトA/1.md') && !present('1.md') && !present('1.png'));
    await open('プロジェクトA/1.md');
    check('edits after move survive reload', await source() === sessionStorage.getItem('folder-move-expected'));
    $('#preview-tab').click(); await waitFor(() => Boolean(document.querySelector<HTMLImageElement>('#preview img')?.naturalWidth));
    check('stored image blob renders after reload', document.querySelector<HTMLImageElement>('#preview img')!.naturalWidth === 192);
    row('プロジェクトA/img/1.png').click(); await waitFor(() => $<HTMLDialogElement>('#image-dialog').open);
    check('stored image opens from tree after reload', $<HTMLImageElement>('#image-preview').naturalWidth > 0);
    $<HTMLDialogElement>('#image-dialog').close();
    const png = await (await fetch('/icons/icon-192.png')).blob();
    const files = [new File(['# 既存の文書\n\n![図](1.png)'], '1.md'), new File(['# 未閲覧の文書\n\n![図](1.png)'], '2.md'), new File([png], '1.png', { type: 'image/png' })];
    for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: `既存ワーク/${file.name}` });
    const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
    $<HTMLInputElement>('#folder-input').files = transfer.files; $('#folder-input').dispatchEvent(new Event('change'));
    await waitFor(() => present('既存ワーク/1.png') && $('#document-name').textContent === '1.md');
    await folder('img', '既存ワーク');
    await move('既存ワーク/1.png', '既存ワーク/img');
    check('existing folder image becomes durable when moved', present('既存ワーク/img/1.png'));
    await open('既存ワーク/2.md');
    check('unopened Markdown in the selected folder also gets updated links', (await source()).includes('![図](img/1.png)'));
    $('#preview-tab').click(); await waitFor(() => Boolean(document.querySelector<HTMLImageElement>('#preview img')?.naturalWidth));
    check('image moved from existing folder still renders', document.querySelector<HTMLImageElement>('#preview img')!.naturalWidth === 192);
    output();
  } catch (error) { $('#folder-regression-result').textContent = JSON.stringify({ passed: false, error: String(error), checks }, null, 2); }
}
export {};
