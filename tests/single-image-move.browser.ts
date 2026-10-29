await import('../src/main');
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
function output(error?: unknown): void { $('#single-image-result').textContent = JSON.stringify({ passed: !error && checks.every(check => check.passed), ...(error ? { error: String(error) } : {}), checks }, null, 2); }
async function drop(files: File[]): Promise<void> {
  const transfer = new DataTransfer(); for (const file of files) transfer.items.add(file);
  row('').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  await ready();
}
async function openImage(path: string): Promise<void> {
  row(path).click();
  await until(() => $<HTMLDialogElement>('#image-dialog').open && $<HTMLImageElement>('#image-preview').naturalWidth > 0);
  check(`image preview ${path}`, $('#image-dialog-name').textContent === path);
}
function closeImage(): void { $('#image-dialog [data-close-dialog]').click(); }
async function moveImage(parent: string): Promise<void> {
  $<HTMLSelectElement>('#image-move-folder').value = parent;
  $('#image-move-folder').dispatchEvent(new Event('change'));
  check(`move action enabled for ${parent || 'root'}`, !$<HTMLButtonElement>('#move-image').disabled);
  $('#move-image').click(); await ready();
  check('image move reports no error', $('#image-move-error').hidden && !$('#image-move-status').hidden);
  await until(() => $<HTMLImageElement>('#image-preview').naturalWidth > 0);
}
async function markdown(): Promise<string> { $('#source-tab').click(); await frame(); return $<HTMLTextAreaElement>('#markdown-input').value; }

$('#run-single-image').onclick = async () => {
  $<HTMLButtonElement>('#run-single-image').disabled = true;
  try {
    const png = await (await fetch('/icons/icon-192.png')).blob();
    await drop([new File([png], '個別画像.png', { type: 'image/png' })]);
    check('single image drop registers root image with no Markdown file', has('個別画像.png') && row('個別画像.png').draggable);
    $('#create-folder').click(); $<HTMLSelectElement>('#folder-parent').value = ''; $<HTMLInputElement>('#folder-name').value = '画像';
    $('#folder-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !$<HTMLDialogElement>('#folder-dialog').open); await ready();
    await openImage('個別画像.png');
    check('same-folder move starts disabled', $<HTMLButtonElement>('#move-image').disabled && $<HTMLSelectElement>('#image-move-folder').value === '');
    await moveImage('画像');
    check('single dropped image moves from preview and old root disappears', has('画像/個別画像.png') && !has('個別画像.png') && $('#image-dialog-name').textContent === '画像/個別画像.png');
    await moveImage('');
    check('preview can move image back to root', has('個別画像.png') && !has('画像/個別画像.png'));
    closeImage(); await frame();
    check('closing preview retains selected draggable image', row('個別画像.png').parentElement!.getAttribute('aria-selected') === 'true' && row('個別画像.png').draggable);
    const transfer = new DataTransfer();
    row('個別画像.png').dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    row('画像').dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    check('image drag exposes move payload and folder highlight', transfer.getData('application/x-shiori-file') === '個別画像.png' && row('画像').classList.contains('drop-target'));
    row('画像').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    await ready(); check('D&D still moves individually dropped image', has('画像/個別画像.png') && !has('個別画像.png'));
    await drop([new File([png], '個別画像.png', { type: 'image/png' })]);
    await drop([new File(['# 個別に追加した画像\n\n![画像](個別画像.png)\n\n```md\n![例](個別画像.png)\n```'], '画像テスト.md', { type: 'text/markdown' })]);
    await openImage('個別画像.png');
    await moveImage('画像');
    check('same-name image is preserved under separate name', has('画像/個別画像.png') && has('画像/個別画像 (2).png') && !has('個別画像.png'));
    closeImage(); await frame();
    const text = await markdown();
    check('Markdown reference follows image move and code stays literal', text.includes(`![画像](${encodeURIComponent('画像')}/${encodeURIComponent('個別画像')}%20%282%29.png)`) && text.includes('![例](個別画像.png)'));
    sessionStorage.setItem('single-image-expected', text);
    $('#preview-tab').click(); await until(() => Boolean(document.querySelector<HTMLImageElement>('#preview img')?.naturalWidth));
    check('Markdown displays moved image', document.querySelector<HTMLImageElement>('#preview img')!.naturalWidth === 192);
    $('#reload-single-image').hidden = false; output();
  } catch (error) { output(error); }
};
$('#reload-single-image').onclick = () => { location.search = '?restore=1'; };
if (new URLSearchParams(location.search).has('restore')) {
  $('#run-single-image').hidden = true;
  try {
    check('individual images stay moved after reload', has('画像/個別画像.png') && has('画像/個別画像 (2).png') && !has('個別画像.png'));
    check('updated Markdown persists after reload', await markdown() === sessionStorage.getItem('single-image-expected'));
    $('#preview-tab').click(); await until(() => Boolean(document.querySelector<HTMLImageElement>('#preview img')?.naturalWidth));
    check('reference renders without selecting original files after reload', document.querySelector<HTMLImageElement>('#preview img')!.naturalWidth === 192);
    await openImage('画像/個別画像 (2).png');
    await moveImage('');
    check('restored single image remains movable', has('個別画像 (2).png') && !has('画像/個別画像 (2).png'));
    await moveImage('画像');
    check('restored image can move again without reconnect', has('画像/個別画像 (2).png') && !$<HTMLDialogElement>('#missing-image-dialog').open);
    output();
  } catch (error) { output(error); }
}
export {};
