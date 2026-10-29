import { build } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { diagramPlugin } from './diagram-plugin.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = path.join(root, 'portable');
const viteRequire = createRequire(createRequire(import.meta.url).resolve('vite/package.json'));
const { parseAst } = await import(pathToFileURL(viteRequire.resolve('rolldown/parseAst')).href);
const result = await build({
  configFile: false,
  root,
  publicDir: false,
  mode: 'portable',
  plugins: [diagramPlugin(), {
    name: 'portable-pwa-stub',
    resolveId(id) { if (id === 'virtual:pwa-register') return '\0portable-pwa'; },
    load(id) { if (id === '\0portable-pwa') return 'export const registerSW = () => async () => {};'; },
  }],
  build: {
    target: 'es2022',
    write: false,
    sourcemap: false,
    minify: true,
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    lib: { entry: path.join(root, 'src/main.ts'), formats: ['es'], fileName: 'shiori' },
    rolldownOptions: { output: { codeSplitting: false } },
    chunkSizeWarningLimit: 12000,
  },
});
const output = (Array.isArray(result) ? result.flatMap(value => value.output) : result.output);
const chunks = output.filter(value => value.type === 'chunk');
const styles = output.filter(value => value.type === 'asset' && value.fileName.endsWith('.css'));
const license = output.find(value => value.type === 'asset' && value.fileName === 'THIRD-PARTY-LICENSES.md');
const diagramLicense = output.find(value => value.type === 'asset' && value.fileName === 'DIAGRAM-LICENSES.md');
const diagramRuntime = output.find(value => value.type === 'asset' && value.fileName === 'diagram-runtime.js');
if (!diagramRuntime) throw new Error('Diagram runtime missing');
const diagramHash = createHash('sha256').update(diagramRuntime.source).digest('base64');
const other = output.filter(value => value.type !== 'chunk' && !value.fileName.endsWith('.css') && value !== license && value !== diagramLicense && value !== diagramRuntime);
if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.some(file => file !== chunks[0].fileName) || other.length) throw new Error('Portable build must contain only one script and inline styles.');
// Rolldown reports inlined dynamic imports as self references in chunk metadata.
// Inspect actual syntax too: an inline module must never fetch another script.
const pending = [parseAst(chunks[0].code)];
while (pending.length) {
  const node = pending.pop();
  if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression' || ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source)) throw new Error('Portable script still has an external import.');
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === 'object' && typeof child.type === 'string') pending.push(child);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') pending.push(value);
  }
}
const script = chunks[0].code.replace(/<\/script/gi, '<\\/script');
const css = styles.map(value => typeof value.source === 'string' ? value.source : Buffer.from(value.source).toString('utf8')).join('\n').replace(/<\/style/gi, '<\\/style');
if (/url\(\s*["']?(?!data:|#)/i.test(css)) throw new Error('Portable CSS contains an external asset.');
const hash = createHash('sha256').update(script).digest('base64');
const favicon = `data:image/png;base64,${(await fs.readFile(path.join(root, 'public/icons/favicon-64.png'))).toString('base64')}`;
if (!license) throw new Error('Third-party license notices are missing.');
const notices = [license, diagramLicense].map(value => { if (!value) throw new Error('Diagram license notices missing'); return typeof value.source === 'string' ? value.source : Buffer.from(value.source).toString('utf8'); }).join('\n\n');
const escapedNotices = notices.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="MarkdownとMermaidをブラウザーだけで表示・編集する単一HTML版。">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}' 'sha256-${diagramHash}'; style-src 'unsafe-inline'; img-src data: blob: https: http:; font-src data:; connect-src https: http:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src blob:">
<link rel="icon" href="${favicon}" type="image/png" sizes="64x64"><title>shiori markdown editor — 単一HTML版</title><style>${css}</style></head>
<body><div id="app"><p class="boot-message">shiori を開いています…</p></div><noscript>JavaScriptを有効にしてください。</noscript><script type="module">${script}</script><template id="shiori-third-party-licenses"><pre>${escapedNotices}</pre></template></body></html>`;
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'shiori.html'), html);
await fs.writeFile(path.join(outDir, 'THIRD-PARTY-LICENSES.md'), notices);
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
await fs.writeFile(path.join(outDir, 'はじめに.txt'), `shiori v${version} 単一HTML版\r\n\r\n1. shiori.htmlをPCへダウンロードします。ZIPの場合は先に展開してください。\r\n2. shiori.htmlをChromeまたはEdgeで開きます。サーバーやインストールは不要です。\r\n3. 「開く」またはドラッグ＆ドロップでMarkdownを1つ選びます。相対パスの画像は「その他 → 参照画像のフォルダー」で指定します。\r\n4. 「保存」はMarkdownをそのまま保存します。「その他」から画像・MermaidのSVGを含む単一HTML、PDFへ出力できます。PDFは印刷画面で「PDFに保存」を選択します。\r\n\r\n配布: このHTMLファイルまたはZIPをSharePoint／Teamsへ置いて共有してください。SharePoint／Teamsのプレビュー内で実行する方式ではありません。\r\n更新: 配布元の新しいHTMLをダウンロードして開いてください。PWAの自動更新はありません。\r\nワーク: ブラウザー内の保存領域はWeb版と別です。Web版のワークを消す必要はありません。編集中の文書を保存し、HTML版で必要なファイルを開いてください。\r\n保存: ローカルHTMLの保存領域はブラウザーやファイルの場所に依存します。同じブラウザーと配置場所で利用し、大切な文書はファイルへ保存してください。\r\n通信: Markdown・Mermaid・WYSIWYGのコードをHTMLに内蔵しています。外部画像の表示を有効にすると画像配信元と通信します。単一HTML版のエクスポートでは外部URL画像を自動取得しません。画像をローカルに保存して相対パスで参照してください。\r\n`);
console.log(`Portable HTML: ${path.join(outDir, 'shiori.html')} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB)`);
