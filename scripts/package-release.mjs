import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { writeZip } from './zip.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version.');
const releaseRoot = path.join(root, 'releases');
const outDir = path.join(releaseRoot, `v${pkg.version}`);
const modules = JSON.parse(await fs.readFile(path.join(releaseRoot, '.module-source.json'), 'utf8'));
const moduleDir = path.join(modules.directory, 'node_modules');
const report = JSON.parse(await fs.readFile(path.join(releaseRoot, '.build-report.json'), 'utf8'));
if (report.version !== pkg.version || ['tests', 'typecheck', 'pwaBuild', 'htmlBuild'].some(key => report[key] !== 'passed')) throw new Error('Run "pnpm release" to build and check this version first.');
await fs.mkdir(outDir, { recursive: true });

const textEntry = (name, value) => ({ name, data: Buffer.from(value, 'utf8') });
const json = value => `${JSON.stringify(value, null, 2)}\n`;
async function walk(directory, prefix = '') {
  const result = [];
  for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = prefix + item.name;
    if (['src-tauri/target', 'src-tauri/gen', 'store/store-identity.json'].includes(name)) continue;
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Distribution cannot contain a symlink: ${name}`);
    if (item.isDirectory()) result.push(...await walk(file, `${name}/`));
    else if (item.isFile()) result.push({ name, file });
  }
  return result;
}
const addPrefix = (entries, prefix) => entries.map(entry => ({ ...entry, name: prefix + entry.name }));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digestCache = new Map();
function contents(entries) {
  return entries.map(entry => {
    const key = entry.file;
    if (key && !digestCache.has(key)) digestCache.set(key, hash(readFileSync(key)));
    return `${key ? digestCache.get(key) : hash(entry.data)}  ${entry.name}`;
  }).join('\n') + '\n';
}

const pwa = await walk(path.join(root, 'dist'));
const pwaNames = new Set(pwa.map(entry => entry.name));
for (const name of ['index.html', 'manifest.webmanifest', 'sw.js', 'THIRD-PARTY-LICENSES.md']) if (!pwaNames.has(name)) throw new Error(`PWA output is missing ${name}.`);
const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) if (!pwaNames.has(icon.src.replace(/^\//, ''))) throw new Error(`PWA icon is missing: ${icon.src}`);
const html = await fs.readFile(path.join(root, 'portable/shiori.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!script || !html.includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`) || /<script[^>]+src=/.test(html)) throw new Error('Single HTML integrity check failed.');
const portable = ['shiori.html', 'はじめに.txt', 'THIRD-PARTY-LICENSES.md'].map(name => ({ name, file: path.join(root, 'portable', name) }));

const source = [];
for (const name of ['src', 'public', 'scripts', 'tests', 'assets', 'src-tauri', 'store', 'docs', '.github', 'patches']) source.push(...await walk(path.join(root, name), `${name}/`));
// The generation prompt refers to a separate project; it is not a build input.
for (let index = source.length - 1; index >= 0; index--) if (source[index].name.endsWith('.prompt.txt')) source.splice(index, 1);
for (const name of ['.gitignore', 'README.md', 'index.html', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'playwright.desktop.config.ts', 'playwright.portable.config.ts']) source.push({ name, file: path.join(root, name) });
const workspace = (await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).replace(/^(?:nodeLinker|extendNodePath):[^\n]*\n?/gm, '');
source.push(textEntry('pnpm-workspace.yaml', `${workspace.trimEnd()}\n\nnodeLinker: hoisted\nextendNodePath: false\n`));
const moduleFiles = (await walk(moduleDir, 'node_modules/')).filter(entry => !['node_modules/.modules.yaml', 'node_modules/.pnpm-workspace-state-v1.json'].includes(entry.name));

const packages = new Map();
async function inventory(directory, prefix = '') {
  const folders = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const child of await fs.readdir(path.join(directory, entry.name), { withFileTypes: true })) if (child.isDirectory()) folders.push(`${entry.name}/${child.name}`);
    } else folders.push(entry.name);
  }
  for (const folder of folders.sort()) {
    const location = path.join(directory, folder);
    const value = JSON.parse(await fs.readFile(path.join(location, 'package.json'), 'utf8'));
    const key = `${value.name}@${value.version}`;
    if (!packages.has(key)) {
      const notices = [];
      for (const file of await fs.readdir(location, { withFileTypes: true })) if (/^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(file.name)) {
        if (file.isFile()) notices.push({ file: file.name, text: await fs.readFile(path.join(location, file.name), 'utf8') });
        if (file.isDirectory()) for (const child of await walk(path.join(location, file.name))) notices.push({ file: `${file.name}/${child.name}`, text: await fs.readFile(child.file, 'utf8') });
      }
      const license = typeof value.license === 'string' ? value.license : value.license?.type ?? (value.licenses ? value.licenses.map(item => item.type ?? item).join(' OR ') : 'UNSPECIFIED');
      packages.set(key, { name: value.name, version: value.version, license, homepage: value.homepage, repository: typeof value.repository === 'string' ? value.repository : value.repository?.url, notices });
    }
    try { if ((await fs.stat(path.join(location, 'node_modules'))).isDirectory()) await inventory(path.join(location, 'node_modules'), `${prefix}${folder}/node_modules/`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await inventory(moduleDir);
const dependencyList = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
const direct = [];
for (const [kind, dependencies] of Object.entries({ runtime: pkg.dependencies, development: pkg.devDependencies })) for (const [name, requested] of Object.entries(dependencies)) {
  const installed = JSON.parse(await fs.readFile(path.join(moduleDir, name, 'package.json'), 'utf8'));
  direct.push({ name, requested, installed: installed.version, kind });
}
const licenseText = `shiori v${pkg.version} — third-party notices\n\nIncludes installed runtime and development dependencies for ${modules.platform}/${modules.arch}.\nThe bundled application notices are also provided separately in each runtime package.\n\n` + dependencyList.map(item => `${'='.repeat(72)}\n${item.name} ${item.version}\nLicense: ${item.license}\n${item.homepage ? `Homepage: ${item.homepage}\n` : ''}${item.repository ? `Repository: ${item.repository}\n` : ''}\n${item.notices.length ? item.notices.map(notice => `--- ${notice.file} ---\n${notice.text}\n`).join('\n') : 'No standalone license file was present in the installed package; see its package metadata and repository.\n'}`).join('\n');
const dependencyJson = json({ application: pkg.name, version: pkg.version, platform: modules.platform, arch: modules.arch, node: process.version, packageManager: pkg.packageManager, direct, packages: dependencyList.map(({ notices, ...item }) => ({ ...item, licenseFiles: notices.map(notice => notice.file) })) });

const pwaGuide = `shiori v${pkg.version} — PWA版\n\nこのフォルダー内の全ファイルを、HTTPSの静的サイトのルートへ配置します。\nassets、icons、manifest.webmanifest、sw.js、workboxのファイルも一緒に配置してください。\n現行の設定はサイトのルート向けです。サブフォルダーへ置く場合はbase・start_url・scopeなどを調整して再ビルドしてください。\n\nChrome／Edgeでサイトを開き、オフライン準備完了を待ちます。ブラウザーのメニューからアプリとしてインストールできます。\nローカルで確認する場合は、ソース一式でビルド後、pnpm previewを使います。\nこのindex.htmlをダブルクリックして開く方式ではありません。\nSharePoint／Teamsからダウンロードして使う用途にはHTML版を選んでください。\n\nこの配布物はビルド済みです。利用時にNode.js・pnpm・node_modulesは不要です。\n`;
const sourceGuide = `shiori v${pkg.version} — 共通ソース／開発モジュール\n\nPWA版と単一HTML版は共通のソースから生成します。アイコン原画と縮小画像も含まれます。\n\n必要環境: Node.js 22.12以上。開発モジュール同梱版は${modules.platform}/${modules.arch}向けです。Node.js本体は同梱していません。\n\n■ node_modules同梱版\n展開したフォルダーで次を実行します。依存パッケージの追加取得やpnpmの実行は不要です。\n  node scripts/build-all.mjs\nテスト・型検査・PWAビルド・HTMLビルドを順に実行します。\n  node node_modules/vite/bin/vite.js --host 127.0.0.1\nで開発サーバーを起動できます。\n\n■ ソースのみの版\npnpm 11.25.0を用意して、次を実行します。初回の依存取得にはインターネット接続が必要です。\n  pnpm install --frozen-lockfile\n  pnpm build:all\n\n■ 生成先\n  dist/                 PWAの静的配信用ファイル\n  portable/shiori.html   単一HTML版\n\n■ 配布セットの再作成\n  pnpm release\nビルドと検証後、配布可能な通常ファイルのnode_modulesを作成してreleases/v${pkg.version}/へZIPを出力します。\n\nnode_modulesはOS・CPUに依存するバイナリーを含みます。他のOS／CPUではpnpm install --frozen-lockfile --forceで依存を取得し直してください。\n同梱したnode_modulesには、元PCの絶対パスへ向いたシンボリックリンク／ジャンクションを含めていません。\n`;
const readme = `shiori v${pkg.version} 配布セット\n\nPWA/     HTTPSの静的サイトへ配置するビルド済みPWA版\nHTML/    サーバー不要の単一HTML版。shiori.htmlをPCへ保存し、Chrome／Edgeで開きます。\nSource/  共通ソース・設定・テスト・アイコンと、${modules.platform}/${modules.arch}用node_modules\nDocuments/  開発手順、依存一覧、第三者ライセンス、ビルド検証結果\n\nSharePoint／Teamsへ置いて配る場合は、HTML版のZIPを共有してください。利用者はダウンロード・展開してHTMLを開きます。\nPWA版はHTTPSで静的配信する環境向けです。\n\nPWA版とHTML版のブラウザー保存領域は別です。どちらも編集後は「保存」でMarkdownファイルに残してください。\nこのセットにはアプリと開発資材を収録しており、利用者のブラウザー内ワークをバックアップするものではありません。\n\nソースの利用条件は配布者が定めます。第三者ライブラリーにはそれぞれのライセンスが適用されます。\nCONTENTS.sha256は各ファイル、SHA256SUMS.txtは各ZIPの検証用です。\n\n検証範囲: 自動テスト・型検査・両ビルド。HTML版はHTTPでの画面・機能確認を行っています。file://でのダブルクリック起動は検証環境の制限により未検証です。\n`;
const docs = [textEntry('DEVELOPMENT.txt', sourceGuide), textEntry('DEPENDENCIES.json', dependencyJson), textEntry('THIRD-PARTY-LICENSES.txt', licenseText), textEntry('BUILD-REPORT.json', json(report))];
pwa.push(textEntry('README.txt', pwaGuide), textEntry('DEPENDENCIES.json', dependencyJson), textEntry('THIRD-PARTY-LICENSES.txt', licenseText));
source.push(textEntry('DEVELOPMENT.txt', sourceGuide), textEntry('DEPENDENCIES.json', dependencyJson), textEntry('THIRD-PARTY-LICENSES.txt', licenseText));
const sourceWithModules = [...source, ...moduleFiles];
const bundle = [textEntry('README.txt', readme), ...addPrefix(pwa, 'PWA/'), ...addPrefix(portable, 'HTML/'), ...addPrefix(sourceWithModules, 'Source/'), ...addPrefix(docs, 'Documents/')];
const outputs = [
  [`shiori-v${pkg.version}-pwa.zip`, pwa, `shiori-v${pkg.version}-pwa/`],
  [`shiori-v${pkg.version}-html.zip`, portable, `shiori-v${pkg.version}-html/`],
  [`shiori-v${pkg.version}-source.zip`, source, `shiori-v${pkg.version}-source/`],
  [`shiori-v${pkg.version}-source-with-node_modules-${modules.platform}-${modules.arch}.zip`, sourceWithModules, `shiori-v${pkg.version}-source/`],
  [`shiori-v${pkg.version}-all.zip`, bundle, `shiori-v${pkg.version}/`],
];
const summaries = [];
for (const [name, entries, prefix] of outputs) {
  console.log(`Packaging ${name} (${entries.length} files)...`);
  const list = addPrefix([...entries, textEntry('CONTENTS.sha256', contents(entries))], prefix).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const destination = path.join(outDir, name);
  writeZip(destination, list);
  summaries.push({ file: name, bytes: (await fs.stat(destination)).size, files: list.length, sha256: hash(await fs.readFile(destination)) });
}
await fs.writeFile(path.join(outDir, 'README.txt'), readme);
await fs.writeFile(path.join(outDir, 'SHA256SUMS.txt'), summaries.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
await fs.writeFile(path.join(outDir, 'release-manifest.json'), json({ application: pkg.name, version: pkg.version, platform: modules.platform, arch: modules.arch, moduleFiles: moduleFiles.length, dependencyPackages: dependencyList.length, artifacts: summaries }));
console.log(json({ directory: outDir, packages: summaries }));
