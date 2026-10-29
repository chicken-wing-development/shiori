import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const listing = JSON.parse(await fs.readFile(path.join(root, 'store/listing.ja-JP.json'), 'utf8'));
const config = JSON.parse(await fs.readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const output = path.join(root, `releases/v${pkg.version}/store/listing`);
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
assert.equal(listing.productName, config.productName);
assert(listing.description.length > 0 && listing.description.length <= 10000);
assert(listing.shortDescription.length <= 1000);
assert(listing.features.length <= 20 && listing.features.every(value => value.length <= 200));
assert(listing.screenshots.length <= 10 && listing.screenshots.every(value => value.caption.length <= 200));
assert.equal(listing.whatsNew, '', 'Initial submissions leave What’s new blank.');
await fs.mkdir(path.join(output, 'website'), { recursive: true });
await fs.mkdir(path.join(output, 'sample'), { recursive: true });
await fs.writeFile(path.join(output, 'listing.ja-JP.json'), JSON.stringify(listing, null, 2) + '\n');
for (const [field, name] of [['description','description'], ['shortDescription','short-description'], ['copyright','copyright']]) {
  await fs.writeFile(path.join(output, `${name}.txt`), listing[field] + '\n');
}
await fs.writeFile(path.join(output, 'features.txt'), listing.features.join('\n') + '\n');
await fs.writeFile(path.join(output, 'keywords.txt'), listing.searchTerms.join('\n') + '\n');
await fs.writeFile(path.join(output, 'screenshot-captions.txt'), listing.screenshots.map(item => `${item.file}\n${item.caption}`).join('\n\n') + '\n');
await fs.copyFile(path.join(root, 'store/reviewer-notes.txt'), path.join(output, 'reviewer-notes.txt'));
await fs.copyFile(path.join(root, 'store/sample/reading-notes.md'), path.join(output, 'sample/reading-notes.md'));
const privacy = await fs.readFile(path.join(root, 'docs/PRIVACY.md'), 'utf8');
await fs.writeFile(path.join(output, 'privacy.txt'), privacy.replace(/^#+ /gm, '').replace(/ {2}\r?\n/g, '\n'));
const body = new MarkdownIt({ html: false, linkify: false }).render(privacy);
await fs.writeFile(path.join(output, 'website/privacy.html'), `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(listing.productName)} — プライバシーに関する通知</title>
<style>html{color-scheme:light dark}body{max-width:760px;margin:48px auto;padding:0 24px;font:16px/1.9 system-ui,sans-serif}h1{font-size:1.65rem;line-height:1.5}p{margin:1.4em 0}footer{margin:48px 0;font-size:.875rem}</style></head>
<body><main>${body}</main><footer>${escape(listing.copyright)}</footer></body></html>\n`);
const iconOutput = path.join(root, 'test-results/store-preparation/icons');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', path.join(root, 'assets/branding/shiori-app-icon-v1.png'), '--output', iconOutput, '--png', '300', '--png', '512'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Icon resize failed');
await fs.copyFile(path.join(iconOutput, '300x300.png'), path.join(output, 'app-icon-300.png'));
await fs.copyFile(path.join(iconOutput, '512x512.png'), path.join(output, 'app-icon-512.png'));
await fs.writeFile(path.join(output, 'README.txt'), `shiori markdown editor ${pkg.version} — Microsoft Store 掲載素材\n\n価格: 無料\n配信地域: ${listing.markets ?? '未確定'}\n言語: 日本語 (ja-JP)\nカテゴリ案: Productivity / 仕事効率化\n\n説明: description.txt\n短い説明: short-description.txt\n機能: features.txt（各行を個別の機能欄へ入力）\n検索語候補: keywords.txt（該当欄がある場合）\n初回提出の「このバージョンの最新情報」は空欄\nプライバシー通知: privacy.txt（本文登録欄へ貼り付け）\n公開用通知ページ: website/privacy.html（未公開。URLではありません）\n問い合わせ先: 掲載しない（ユーザー指定）\nStoreアイコン: app-icon-300.png\n審査担当者向けメモ: reviewer-notes.txt\n動作確認用文書: sample/reading-notes.md\n\nスクリーンショットの撮影方法と検証状況は screenshots/provenance.json を確認してください。\n年齢評価はPartner CenterのIARC質問票への回答後に確定します。\n\n提出ファイルは ../upload/ 内の .msixbundle です。この素材フォルダー全体はアプリパッケージとしてアップロードしません。\n`);
console.log(`Store listing assets: ${output}`);
