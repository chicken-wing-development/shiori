const $ = selector => document.querySelector(selector);
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const temporary = new URLSearchParams(location.search).has('temporary');
const restore = new URLSearchParams(location.search).has('restore');
const checks = [];
async function until(predicate) {
  for (let i = 0; i < 600; i++) { if (predicate()) { await frame(); return; } await frame(); }
  throw new Error('UI operation timed out');
}
async function ready() { await frame(); await until(() => !$('#app').inert && $('#app').dataset.ready === 'true'); }
function check(name, passed) { checks.push({ name, passed }); if (!passed) throw new Error(name); }
const row = path => $(`[data-tree-row="${path}"]`);
const has = path => Boolean(row(path));
function reveal(path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) { const element = row(parts.slice(0, i).join('/')); if (element.parentElement.getAttribute('aria-expanded') === 'false') element.click(); }
}
async function source() { $('#source-tab').click(); await frame(); return $('#markdown-input').value; }
async function selectEnd(element) {
  $('.rich-content').focus();
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange')); await frame(); await frame();
}
function output(error) {
  const result = { passed: !error && checks.every(value => value.passed), ...(error ? { error: String(error) } : {}), checks };
  $('#portable-result').textContent = JSON.stringify(result, null, 2);
  if (temporary) window.parent.postMessage({ kind: 'shiori-portable-temporary', result }, 'http://127.0.0.1:4193');
}
async function run() {
  $('#run-portable').disabled = true;
  try {
    await ready();
    check('portable branding and no PWA install prompt', $('.brand-caption').textContent === '単一HTML版' && $('#install-button').hidden);
    check('browser storage mode is explained accurately', $('#temporary-storage').hidden !== temporary);
    if (restore) {
      check('workspace and edited Markdown restore', await source() === sessionStorage.getItem('portable-expected'));
      check('image relocation survives reload', has('単一HTMLテスト/画像置き場/図.png') && !has('単一HTMLテスト/img/図.png'));
      $('#preview-tab').click();
      await until(() => $('#preview img')?.naturalWidth > 0 && $('#preview .diagram-content svg'));
      check('embedded Mermaid and stored image render after reload', $('#preview img').naturalWidth === 192);
      output(); return;
    }
    $('#version-button').click(); $('#check-updates').click();
    check('updates refer to the distributed HTML', $('#update-check-result').textContent.includes('SharePoint／Teams'));
    $('#help-dialog [data-close-dialog]').click();
    const content = '# 単一HTMLの動作確認\n\n編集する段落\n\n![ローカル画像](img/図.png)\n\n```mermaid\nflowchart LR\n  A[ファイルを開く] --> B[編集と保存]\n```\n\n| 列1 | 列2 |\n| --- | --- |\n| A | B |';
    const png = Uint8Array.from(atob('__PNG_BASE64__'), value => value.charCodeAt(0));
    const files = [new File([content], '1.md', { type: 'text/markdown' }), new File([png], '図.png', { type: 'image/png' })];
    Object.defineProperty(files[0], 'webkitRelativePath', { value: '単一HTMLテスト/1.md' });
    Object.defineProperty(files[1], 'webkitRelativePath', { value: '単一HTMLテスト/img/図.png' });
    const transfer = new DataTransfer(); for (const file of files) transfer.items.add(file);
    $('#folder-input').files = transfer.files; $('#folder-input').dispatchEvent(new Event('change'));
    await ready(); await until(() => $('#document-name').textContent === '1.md' && $('#preview img')?.naturalWidth > 0 && $('#preview .diagram-content svg'));
    check('folder, local image and Mermaid work without external modules', has('単一HTMLテスト/1.md') && $('#preview img').naturalWidth === 192);
    const before = await source(); $('#markdown-input').value = before + '\n\n追記した文章'; $('#markdown-input').dispatchEvent(new Event('input'));
    await ready(); $('#wysiwyg-tab').click();
    await until(() => $('.rich-content') && $('#rich-view').getAttribute('aria-busy') !== 'true');
    await selectEnd($('.rich-content h1')); $('#block-style').value = '2'; $('#block-style').dispatchEvent(new Event('change'));
    check('WYSIWYG heading control works in the single bundle', Boolean($('.rich-content h2')));
    await selectEnd(Array.from(document.querySelectorAll('.rich-content p')).find(element => element.textContent === '編集する段落'));
    $('.table-menu > summary').click(); $('[data-rich-action="table"]').click();
    check('WYSIWYG table insertion works', document.querySelectorAll('.rich-content table').length === 2);
    let updated = await source();
    check('Markdown and WYSIWYG edits survive mode changes', updated.includes('## 単一HTMLの動作確認') && updated.includes('追記した文章') && updated.includes('flowchart LR'));
    $('#preview-tab').click(); await ready();
    $('#create-folder').click(); $('#folder-parent').value = '単一HTMLテスト'; $('#folder-name').value = '画像置き場';
    $('#folder-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !$('#folder-dialog').open); await ready();
    reveal('単一HTMLテスト/img/図.png');
    const drag = new DataTransfer(); row('単一HTMLテスト/img/図.png').dispatchEvent(new DragEvent('dragstart', { dataTransfer: drag, bubbles: true, cancelable: true }));
    row('単一HTMLテスト/画像置き場').dispatchEvent(new DragEvent('drop', { dataTransfer: drag, bubbles: true, cancelable: true }));
    await ready();
    check('image moves and Markdown reference follows', has('単一HTMLテスト/画像置き場/図.png') && (await source()).includes(encodeURIComponent('画像置き場')));
    const extra = new DataTransfer(); extra.items.add(new File(['disposable'], '削除用.bin'));
    row('').dispatchEvent(new DragEvent('drop', { dataTransfer: extra, bubbles: true, cancelable: true })); await ready();
    row('削除用.bin').querySelector('[data-remove-tree]').click(); $('#cancel-remove').click(); await frame();
    check('cancel keeps the target file', has('削除用.bin'));
    row('削除用.bin').querySelector('[data-remove-tree]').click(); $('#confirm-remove').click();
    await until(() => !$('#remove-dialog').open); await ready();
    check('individual deletion works', !has('削除用.bin') && has('単一HTMLテスト/1.md'));
    updated = await source();
    const blobs = new Map(); const originalCreate = URL.createObjectURL;
    URL.createObjectURL = blob => { const url = originalCreate.call(URL, blob); blobs.set(url, blob); return url; };
    let saved;
    const captureDownload = event => { const anchor = event.target.closest('a[download]'); if (anchor) { event.preventDefault(); saved = blobs.get(anchor.href); } };
    document.addEventListener('click', captureDownload, true);
    try { $('#save-button').click(); await until(() => Boolean(saved)); check('Markdown save produces the current edited content', await saved.text() === updated); }
    finally { URL.createObjectURL = originalCreate; document.removeEventListener('click', captureDownload, true); }
    $('#preview-tab').click(); await until(() => $('#preview img')?.naturalWidth > 0 && $('#preview .diagram-content svg'));
    check('final local image and diagram remain visible', $('#preview img').naturalWidth === 192);
    if (temporary) check('temporary edits do not claim persistent saving', !$('#document-status').textContent.includes('保存済み'));
    else { sessionStorage.setItem('portable-expected', updated); $('#reload-portable').hidden = false; }
    output();
  } catch (error) { output(error); }
}
$('#run-portable').onclick = run;
$('#reload-portable').onclick = () => { location.search = '?restore=1'; };
if (temporary || restore) await run();
