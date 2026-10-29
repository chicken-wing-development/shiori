import { compileMarkdown } from '../src/markdown';

await import('../src/main');
const button = document.querySelector<HTMLButtonElement>('#run-input-regression')!;
const result = document.querySelector('#input-regression-result')!;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const inputPause = () => new Promise<void>(resolve => setTimeout(resolve, 350));

function cursorAtEnd(element: HTMLElement): void {
  element.closest<HTMLElement>('.rich-content')!.focus();
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

function enter(shiftKey = false): void {
  document.querySelector<HTMLElement>('.rich-content')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey, bubbles: true, cancelable: true }));
}

button.onclick = async () => {
  button.disabled = true; result.textContent = '入力を確認しています…';
  try {
    document.querySelector<HTMLButtonElement>('#paste-button')!.click();
    document.querySelector<HTMLInputElement>('#paste-name')!.value = '改行の確認.md';
    document.querySelector<HTMLTextAreaElement>('#paste-input')!.value = '一行目\n\n```mermaid\nflowchart LR\n  A --> B\n```';
    document.querySelector<HTMLButtonElement>('#load-paste')!.click();
    document.querySelector<HTMLButtonElement>('#wysiwyg-tab')!.click();
    for (let attempt = 0; attempt < 300; attempt++) {
      if (document.querySelector('.rich-content') && document.querySelector('#rich-view')?.getAttribute('aria-busy') !== 'true') break;
      await frame();
    }
    const first = document.querySelector<HTMLElement>('.rich-content > p')!;
    cursorAtEnd(first); await frame(); enter(); await frame();
    document.execCommand('insertText', false, '二行目'); await inputPause();
    const second = document.querySelectorAll<HTMLElement>('.rich-content > p')[1];
    const paragraphBreak = first.textContent === '一行目' && second?.textContent === '二行目';
    enter(true); await frame(); document.execCommand('insertText', false, '同じ段落の続き'); await inputPause();
    const hardBreak = second?.querySelector('br') !== null && second?.textContent === '二行目同じ段落の続き';
    const code = document.querySelector<HTMLElement>('.rich-code-block code')!;
    cursorAtEnd(code); await frame(); enter(); await frame(); document.execCommand('insertText', false, '  B --> C'); await inputPause();
    const codeBreak = code.textContent === 'flowchart LR\n  A --> B\n  B --> C';
    document.querySelector<HTMLButtonElement>('#source-tab')!.click(); await frame();
    const markdown = document.querySelector<HTMLTextAreaElement>('#markdown-input')!.value;
    const compiled = compileMarkdown(markdown);
    const previewPreserved = compiled.html.includes('一行目</p>') && compiled.html.includes('<br>') && compiled.diagrams[0]?.source.includes('A --> B\n  B --> C');
    result.textContent = JSON.stringify({ passed: paragraphBreak && hardBreak && codeBreak && previewPreserved, paragraphBreak, hardBreak, codeBreak, previewPreserved, markdown }, null, 2);
  } catch (error) { result.textContent = JSON.stringify({ passed: false, error: String(error) }); }
};
