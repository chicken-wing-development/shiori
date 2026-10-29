import { RichEditor } from '../src/rich-editor';
import '../src/style.css';

const select = document.querySelector<HTMLSelectElement>('#block-style')!;
const host = document.querySelector<HTMLElement>('#heading-editor')!;
let markdown = '';
const editor = new RichEditor(host, document.querySelector<HTMLElement>('#heading-toolbar')!, '## はじめに\n\n本文は保持します。', { resolve: () => undefined }, value => { markdown = value; });
select.onchange = () => editor.setBlock(select.value);
document.querySelector<HTMLButtonElement>('#run-heading-regression')!.onclick = async () => {
  document.querySelector<HTMLButtonElement>('#run-heading-regression')!.disabled = true;
  select.focus();
  select.value = '1';
  // A queued editor selection/blur transaction can arrive between choosing
  // an option in the native menu and committing its change event.
  editor.selectRange({ from: 2, to: 2 }, false);
  const pendingValuePreserved = select.value === '1';
  select.dispatchEvent(new Event('change'));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const headingChanged = host.querySelector('h1')?.textContent === 'はじめに';
  const bodyPreserved = host.querySelector('p')?.textContent === '本文は保持します。';
  document.querySelector('#heading-regression-result')!.textContent = JSON.stringify({ passed: pendingValuePreserved && headingChanged && bodyPreserved && markdown.startsWith('# はじめに\n'), pendingValuePreserved, headingChanged, bodyPreserved, markdown }, null, 2);
};
