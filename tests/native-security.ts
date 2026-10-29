// Development-only integration fixture, never included in the release entry.
import { invoke } from '@tauri-apps/api/core';
import { buildHtmlDocument } from '../src/export-document';
import { exportPdfFile, exportTextFile } from '../src/save-file';

const results: { name: string; passed: boolean; detail?: string }[] = [];
const report = async () => {
  document.querySelector('#results')!.textContent = JSON.stringify({ userAgent: navigator.userAgent, results }, null, 2);
  await fetch('/__security-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userAgent: navigator.userAgent, results }) });
};
async function check(name: string, action: () => Promise<void>) {
  try { await action(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, detail: String(error) }); }
  await report();
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const png = await (await fetch('/icons/icon-192.png')).blob();
const bad = () => buildHtmlDocument('![bad](bad.png)', { title: 'Bad PNG', resolveImageFile: () => new File(['not image bytes'], 'bad.png') });
const good = () => buildHtmlDocument('# 実WebView2 セキュリティ検証\n\n画像と日本語を正しく出力します。\n\n![正常画像](valid.png)\n\n[Webリンク](//example.com/document)\n\n~~~mermaid\nflowchart LR\n A[入力の検証] --> B[安全な出力]\n~~~', { title: '実WebView2 セキュリティ検証', resolveImageFile: () => new File([png], 'valid.png') });

await check('real IPC rejects internal destinations before networking', async () => {
  for (const host of ['127.0.0.1:4188', '2130706433:4188', 'localhost:4188', '[::1]:4188', '192.168.1.1:4188', '169.254.169.254']) {
    let error = ''; try { await invoke('fetch_export_image', { source: `http://${host}/private.png` }); } catch (e) { error = String(e); }
    assert(error.includes('内部ネットワーク'), `${host}: ${error || 'unexpected success'}`);
  }
});
await check('export pipeline rejects loopback through real Rust command', async () => {
  let error = ''; try { await buildHtmlDocument('![local](http://127.0.0.1:4188/private.png)', { title: 'Blocked' }); } catch (e) { error = String(e); }
  assert(error.includes('内部ネットワーク'), error || 'unexpected success');
});
await check('real WebView2 rejects corrupt local and data images', async () => {
  for (const generate of [bad, () => buildHtmlDocument(`![bad](data:image/png;base64,${btoa('not image bytes')})`, { title: 'Bad data' }), () => buildHtmlDocument('![bad](bad.png)', { title: 'Truncated', resolveImageFile: () => new File([png.slice(0, 24)], 'bad.png') })]) {
    let error = ''; try { await generate(); } catch (e) { error = String(e); }
    assert(error.includes('画像のデータが不正'), error || 'unexpected success');
  }
});
await check('real Rust TLS download embeds a public image', async () => {
  const output = await buildHtmlDocument('![W3C](https://www.w3.org/assets/logos/w3c-2025-transitional/w3c-72x48.png)', { title: 'Public image' });
  assert(output.images === 1 && output.content.includes('data:image/png;base64,'), 'missing embedded public image');
});
await check('network-path link becomes HTTPS and valid images decode', async () => {
  const output = await good();
  const doc = new DOMParser().parseFromString(output.content, 'text/html');
  assert(doc.querySelector('a')?.getAttribute('href') === 'https://example.com/document', 'unsafe link');
  assert(doc.images.length === 2, 'missing PNG or Mermaid');
  for (const element of doc.images) { const image = new Image(); image.src = element.src; await image.decode(); assert(image.naturalWidth > 0, 'broken image'); }
});

for (const valid of [false, true]) for (const format of ['html', 'pdf'] as const) {
  const id = `${valid ? 'valid' : 'invalid'}-${format}`;
  document.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = async () => {
    document.querySelector('#actions')!.setAttribute('hidden', '');
    document.querySelector('#status')!.textContent = `${id}: 保存ダイアログで ${id}.${format} を指定してください。`;
    await check(`${id}: real native save flow`, async () => {
      let error = ''; let result = '';
      const content = async () => (await (valid ? good() : bad())).content;
      try { result = format === 'pdf' ? await exportPdfFile(id, content) : await exportTextFile({ name: `${id}.html`, description: 'HTML', mime: 'text/html', extensions: ['.html'], content }); }
      catch (e) { error = String(e); }
      if (valid) assert(result === 'saved', error || result);
      else assert(error.includes('画像のデータが不正'), error || 'unexpected success/cancel');
    });
    document.querySelector('#actions')!.removeAttribute('hidden');
    document.querySelector('#status')!.textContent = `${id}: 検証終了`;
  };
}
document.querySelector('#actions')!.removeAttribute('hidden');
document.querySelector('#status')!.textContent = '自動検証が終了しました。保存処理を確認できます。';
