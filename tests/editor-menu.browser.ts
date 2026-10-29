await import('../src/main');
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const settle = async () => { await frame(); await frame(); };
const results: { name: string; passed: boolean }[] = [];
const check = (name: string, passed: boolean) => { results.push({ name, passed }); };

async function reset(source: string): Promise<void> {
  $('#source-tab').click();
  const input = $<HTMLTextAreaElement>('#markdown-input'); input.value = source; input.dispatchEvent(new Event('input'));
  $('#wysiwyg-tab').click();
  for (let attempt = 0; attempt < 300; attempt++) {
    if (document.querySelector('#rich-view:not([aria-busy]) .rich-content')) break;
    await frame();
  }
  await settle();
}

async function select(element: HTMLElement, from = 0, to?: number): Promise<void> {
  $('.rich-content').focus();
  const range = document.createRange();
  if (to === undefined) { range.selectNodeContents(element); range.collapse(false); }
  else { range.setStart(element.firstChild!, from); range.setEnd(element.firstChild!, to); }
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange')); await settle();
}

async function click(element: HTMLElement): Promise<void> {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element.click(); await settle();
}
const action = (name: string) => click($(`[data-rich-action="${name}"]`));
async function tableAction(name: string): Promise<void> { await click($('.table-menu > summary')); await action(name); }

$('#run-menu-regression').onclick = async () => {
  $<HTMLButtonElement>('#run-menu-regression').disabled = true;
  $('#menu-regression-result').textContent = '編集メニューを確認しています…';
  try {
    $('#new-document').click(); await settle();
    await reset('コードにする文章'); await select($('.rich-content > p'));
    await action('codeBlock'); check('code block', $('.rich-code-block code')?.textContent === 'コードにする文章');
    await action('codeBlock'); check('code block toggles back', !document.querySelector('.rich-code-block') && $('.rich-content > p').textContent === 'コードにする文章');

    await reset('表の前の文章'); await select($('.rich-content > p'));
    await tableAction('table'); check('insert 3 by 3 table', document.querySelectorAll('.rich-content tr').length === 3 && document.querySelectorAll('.rich-content td,.rich-content th').length === 9);
    await select($('.rich-content td p')); await tableAction('addRowAfter'); check('add row', document.querySelectorAll('.rich-content tr').length === 4);
    await tableAction('addColumnAfter'); check('add column', document.querySelectorAll('.rich-content tr:first-child > *').length === 4);
    await tableAction('deleteRow'); check('delete row', document.querySelectorAll('.rich-content tr').length === 3);
    await tableAction('deleteColumn'); check('delete column', document.querySelectorAll('.rich-content tr:first-child > *').length === 3);
    await tableAction('deleteTable'); check('delete table keeps text', !document.querySelector('.rich-content table') && $('.rich-content').textContent!.includes('表の前の文章'));

    for (const [name, selector] of [['bold', 'strong'], ['italic', 'em'], ['strike', 's'], ['code', 'p code']] as const) {
      await reset('書式を変更する'); await select($('.rich-content > p'), 0, 2); await action(name);
      check(name, $(`.rich-content ${selector}`)?.textContent === '書式');
    }
    for (const [name, selector] of [['bulletList', 'ul'], ['orderedList', 'ol'], ['taskList', 'ul[data-type="taskList"]'], ['blockquote', 'blockquote']] as const) {
      await reset('段落を変換する'); await select($('.rich-content > p')); await action(name);
      check(name, Boolean(document.querySelector(`.rich-content ${selector}`)));
      await action('undo'); check(`${name} undo`, !document.querySelector(`.rich-content ${selector}`));
      await action('redo'); check(`${name} redo`, Boolean(document.querySelector(`.rich-content ${selector}`)));
    }

    await reset('リンク対象'); await select($('.rich-content > p'), 0, 5); await action('link');
    $<HTMLInputElement>('#insert-source').value = 'https://example.com'; $<HTMLInputElement>('#insert-label').value = '参照先';
    $('#insert-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
    check('link dialog keeps selection', $('.rich-content a')?.textContent === '参照先' && $('.rich-content a').getAttribute('href') === 'https://example.com');
    await select($('.rich-content > p')); await action('image');
    $<HTMLInputElement>('#insert-source').value = './img/sample.png'; $<HTMLInputElement>('#insert-label').value = '図';
    $('#insert-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
    check('image dialog', Boolean(document.querySelector('.rich-image')));

    await reset(''); await select($('.rich-content > p')); await action('mermaid');
    check('Mermaid insertion', $('.rich-code-block[data-language="mermaid"] code')?.textContent!.includes('flowchart LR') === true);

    await reset('対象の段落\n\n別の段落');
    await select($('.rich-content > p:first-child'));
    $('[data-rich-action="codeBlock"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    // Model a delayed selection update arriving while a toolbar operation is in progress.
    await select($('.rich-content > p:nth-child(2)'));
    $('[data-rich-action="codeBlock"]').click(); await settle();
    check('toolbar keeps original paragraph', $('.rich-code-block code')?.textContent === '対象の段落' && $('.rich-content > p').textContent === '別の段落');
    $('#source-tab').click(); await settle();
    check('source reflects code block', $<HTMLTextAreaElement>('#markdown-input').value.includes('```\n対象の段落\n```'));
    check('no command errors', $('#editor-feedback').hidden);
    $('#menu-regression-result').textContent = JSON.stringify({ passed: results.every(result => result.passed), checks: results }, null, 2);
  } catch (error) { $('#menu-regression-result').textContent = JSON.stringify({ passed: false, error: String(error), checks: results }, null, 2); }
};
export {};
