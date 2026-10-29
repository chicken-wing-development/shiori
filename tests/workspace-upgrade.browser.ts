import type { ReaderDocument } from '../src/types';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const settle = async () => { await frame(); await frame(); };
const results: { name: string; passed: boolean }[] = [];
const check = (name: string, passed: boolean) => results.push({ name, passed });
const first: ReaderDocument = { id: 'legacy-main', name: '1.md', path: 'プロジェクトA/1.md', origin: 'local', openedAt: 100, content: '# 以前からある文書\r\n\r\n表にする段落\r\n\r\nコードにする段落\r\n\r\n![既存の図](img/1.png)\r\n\r\n```mermaid\r\nflowchart LR\r\n  A[開始] --> B[完了]\r\n```' };
const second: ReaderDocument = { id: 'legacy-unlinked', name: '1.md', path: 'プロジェクトB/1.md', origin: 'local', openedAt: 90, content: '# 別プロジェクトの文書\n\nファイルの本文' };
const draft: ReaderDocument = { ...second, openedAt: 80, content: '# 別プロジェクトの文書\n\n編集中の下書きを保持' };
const draftOnly: ReaderDocument = { id: 'legacy-draft-only', name: '未保存メモ.md', origin: 'paste', openedAt: 70, content: '下書きだけに残っているメモ' };

// Model the exact pre-upgrade databases, retaining the old reader connection.
let legacyConnection: IDBDatabase;
async function seed(name: string, store: string, documents: ReaderDocument[]): Promise<IDBDatabase> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); documents.forEach(doc => tx.objectStore(store).put(doc));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  return db;
}
async function waitForEditor(name: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if ($('#document-name')?.textContent === name && document.querySelector('#rich-view:not([aria-busy]) .rich-content')) { await settle(); return; }
    await frame();
  }
  throw new Error(`Editor did not restore: ${name}`);
}
async function select(element: HTMLElement, text = false): Promise<void> {
  $('.rich-content').focus();
  const range = document.createRange(); range.selectNodeContents(element); if (!text) range.collapse(false);
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange')); await settle();
}
async function click(element: HTMLElement): Promise<void> {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  element.click(); await settle();
}
async function action(name: string): Promise<void> { await click($(`[data-rich-action="${name}"]`)); }
async function openPath(path: string, name: string): Promise<void> {
  $(`[data-tree-row="${path}"]`).click(); await waitForEditor(name);
}
function show(): void { $('#upgrade-regression-result').textContent = JSON.stringify({ passed: results.every(result => result.passed), checks: results }, null, 2); }
async function readAll(db: IDBDatabase, store: string): Promise<ReaderDocument[]> {
  return await new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

$('#run-upgrade-regression').onclick = async () => {
  $<HTMLButtonElement>('#run-upgrade-regression').disabled = true;
  $('#upgrade-regression-result').textContent = '旧版データを引き継いで確認しています…';
  try {
    legacyConnection = await seed('shiori-reader', 'documents', [first, second]);
    const oldDrafts = await seed('shiori-reader-drafts', 'drafts', [draft, draftOnly]); oldDrafts.close();
    localStorage.setItem('shiori:workspace', JSON.stringify([{ path: first.path, documentId: first.id }, { path: 'プロジェクトA/img/1.png' }, { path: second.path, documentId: 'broken-old-link' }]));
    localStorage.setItem('shiori:workspaceExpanded', JSON.stringify(['', 'プロジェクトA', 'プロジェクトA/img', 'プロジェクトB']));
    localStorage.setItem('shiori:lastDocument', JSON.stringify(first.id));
    localStorage.setItem('shiori:viewMode', JSON.stringify('wysiwyg'));
    await import('../src/main'); await waitForEditor(first.name);
    check('existing document and selected editing mode restored', $('.rich-content h1')?.textContent === '以前からある文書' && $('#wysiwyg-tab').getAttribute('aria-pressed') === 'true');
    check('folders and image entry kept', Boolean(document.querySelector('[data-tree-row="プロジェクトA/img/1.png"]')));
    const storage = await import('../src/storage');
    check('migration copied Markdown byte for byte', (await storage.getWorkspaceDocuments()).find(doc => doc.id === first.id)?.content === first.content);
    check('migration did not erase old history', (await readAll(legacyConnection, 'documents')).some(doc => doc.id === first.id && doc.content === first.content));

    await select($('.rich-content h1'));
    $<HTMLSelectElement>('#block-style').value = '2'; $('#block-style').dispatchEvent(new Event('change')); await settle();
    check('heading changes in restored document', $('.rich-content h2')?.textContent === '以前からある文書');
    const paragraph = Array.from(document.querySelectorAll<HTMLElement>('.rich-content > p')).find(p => p.textContent === '表にする段落')!;
    await select(paragraph);
    $('.rich-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); await settle();
    document.execCommand('insertText', false, '更新後も改行できます'); await settle();
    check('Enter and Japanese typing in restored document', $('.rich-content').textContent!.includes('更新後も改行できます'));
    await click($('.table-menu > summary')); await action('table');
    check('table insertion in restored document', document.querySelectorAll('.rich-content tr').length === 3);
    const codeParagraph = Array.from(document.querySelectorAll<HTMLElement>('.rich-content > p')).find(p => p.textContent === 'コードにする段落')!;
    await select(codeParagraph); await action('codeBlock');
    check('code block in restored document', Array.from(document.querySelectorAll('.rich-code-block code')).some(code => code.textContent === 'コードにする段落'));
    check('Mermaid and image paths preserved', $('.rich-code-block[data-language="mermaid"] code').textContent!.includes('A[開始] --> B[完了]') && $('.rich-image').getAttribute('title') === 'img/1.png');

    await openPath(second.path!, second.name);
    check('dangling tree link repaired and draft preferred', $('.rich-content').textContent!.includes('編集中の下書きを保持') && !$('.rich-content').textContent!.includes('ファイルの本文'));
    await openPath(draftOnly.name, draftOnly.name);
    check('draft-only document recovered without clearing work', $('.rich-content').textContent!.includes(draftOnly.content));
    for (let i = 0; i < 13; i++) {
      $('#paste-button').click(); $<HTMLInputElement>('#paste-name').value = `追加${i}.md`;
      $<HTMLTextAreaElement>('#paste-input').value = `閲覧履歴${i}`; $('#load-paste').click(); await waitForEditor(`追加${i}.md`);
    }
    await storage.saveDocument({ ...second, id: 'cache-tail', path: '履歴の末尾.md', name: '履歴の末尾.md', openedAt: Date.now() });
    check('old document has left twelve-item cache', !(await storage.getRecentDocuments()).some(doc => doc.id === first.id));
    await openPath(first.path!, first.name);
    check('workspace body still opens after history eviction', $('.rich-content').textContent!.includes('更新後も改行できます') && Boolean(document.querySelector('.rich-content table')));
    check('no editor command failures', $('#editor-feedback').hidden);
    await select($('.rich-content h2'), true); await action('bold');
    check('restored document remains editable after switching', Boolean(document.querySelector('.rich-content h2 strong')));
    $('#source-tab').click(); await settle();
    sessionStorage.setItem('upgrade-expected-markdown', $<HTMLTextAreaElement>('#markdown-input').value);
    $('#wysiwyg-tab').click(); await waitForEditor(first.name);
    $('#reload-upgrade-regression').hidden = false; show();
  } catch (error) { $('#upgrade-regression-result').textContent = JSON.stringify({ passed: false, error: String(error), checks: results }, null, 2); }
};
$('#reload-upgrade-regression').onclick = () => { location.search = '?verify=1'; };
if (new URLSearchParams(location.search).has('verify')) {
  $('#run-upgrade-regression').hidden = true;
  try {
    await import('../src/main'); await waitForEditor(first.name);
    check('last document restored again without workspace deletion', Boolean(document.querySelector('.rich-content table')) && $('.rich-content').textContent!.includes('更新後も改行できます'));
    $('#source-tab').click(); await settle();
    check('saved edited Markdown preserved exactly across reload', $<HTMLTextAreaElement>('#markdown-input').value === sessionStorage.getItem('upgrade-expected-markdown'));
    $('#wysiwyg-tab').click(); await waitForEditor(first.name);
    await openPath('追加0.md', '追加0.md');
    check('unedited document outside the recent cache restored from durable workspace', $('.rich-content').textContent === '閲覧履歴0');
    await openPath(first.path!, first.name);
    await select($('.rich-content h2')); await action('codeBlock');
    check('menu commands work immediately after reload', Array.from(document.querySelectorAll('.rich-code-block code')).some(code => code.textContent === '以前からある文書'));
    show();
  } catch (error) { $('#upgrade-regression-result').textContent = JSON.stringify({ passed: false, error: String(error), checks: results }, null, 2); }
}
