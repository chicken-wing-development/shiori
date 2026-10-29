import { registerSW } from 'virtual:pwa-register';
import { version as appVersion } from '../package.json';
import shioriMark from '../assets/branding/shiori-mark-256.png?inline';
import { compileMarkdown, escapeHtml } from './markdown';
import { sanitizeMarkdown } from './sanitize';
import { renderDiagrams, renderDiagramSvg } from './diagrams';
import { referencedImages } from './document-assets';
import { buildHtmlDocument, type HtmlDocument } from './export-document';
import { embeddedImage } from './image-data';
import { isDesktop, openExternalLink } from './platform';
import type { NativeDocument, NativeOpenedDocument } from './native-document';
import { DOCUMENT_SIZE_MESSAGE, validateDocumentContent } from './document-input';
import { exportJobs } from './export-jobs';
import { FileWorkspace, isImageFile, isMarkdownFile, readDocument, resolveLocalPath } from './files';
import { loadEditorSession, saveEditorSession, readPreference, writePreference, usesTemporaryStorage, type EditorSession } from './storage';
import { exportTextFile, exportPdfFile, exportFileName, type SaveResult } from './save-file';
import { richEditorMarkup } from './editor-ui';
import { appInfoMarkup, setupAppInfo } from './app-info';
import { setupOutlineResizer } from './outline-resizer';
import type { RichEditor } from './rich-editor';
import { icon } from './icons';
import type { CompiledDocument, ReaderDocument, Theme, ViewMode } from './types';
import './style.css';
const $ = <T extends HTMLElement = HTMLElement,>(selector: string): T => document.querySelector<T>(selector)!;
const app = $('#app');
const isPortable = import.meta.env.MODE === 'portable';
const newDocument = (): ReaderDocument => ({
  id: crypto.randomUUID(),
  name: '無題.md',
  content: '',
  openedAt: Date.now(),
  origin: 'paste'
});
let current = newDocument();
let nativeDocument: NativeDocument | undefined;
let nativeImageLoad: Promise<void> = Promise.resolve();
let picking = false;
let dirty = false;
let opening = false;
let ready = false;
let theme: Theme = readPreference<Theme>('theme', 'light') === 'dark' ? 'dark' : 'light';
const rememberedView = readPreference<ViewMode>('viewMode', 'wysiwyg');
let mode: ViewMode = ['preview', 'source', 'wysiwyg'].includes(rememberedView) ? rememberedView : 'wysiwyg';
let fontSize = Math.max(13, Math.min(22, Number(readPreference('fontSize', 16)) || 16));
const images = new FileWorkspace();
let allowRemoteImages = false;
let compiled: CompiledDocument;
let renderVersion = 0;
let diagramsReady: Promise<void> = Promise.resolve();
let richEditor: RichEditor | undefined;
let richSource: string | undefined;
let richDocumentId: string | undefined;
let richLoad = 0;
let previewTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let searchTimer: ReturnType<typeof setTimeout>;
let searchMarks: HTMLElement[] = [];
let searchIndex = -1;
let editMatches: {
  from: number;
  to: number;
}[] = [];
let pendingSession: EditorSession | undefined;
let sessionWrite: Promise<void> | undefined;
let sessionFailed = false;
let savePromise: Promise<SaveResult> | undefined;
let resolveSave: ((result: SaveResult) => void) | undefined;
let saving = false;
app.innerHTML = `
  <a class="skip-link" href="#document-scroll">本文に移動</a>
  <main class="main">
    <header class="topbar">
      <div class="breadcrumb"><span class="brand"><img src="${shioriMark}" alt="" width="29" height="34" />shiori</span><span class="topbar-divider"></span><span id="document-name">無題.md</span><span id="dirty-mark" title="ファイルに未保存" aria-label="ファイルに未保存" hidden>●</span></div>
      <div class="topbar-actions"><button class="icon-button" id="search-button" title="文書内を検索 (Ctrl+F)" aria-label="文書内を検索">${icon('search')}</button><details class="file-menu" id="file-menu"><summary aria-label="その他の操作">その他 ${icon('down')}</summary><div class="file-menu-items"><button id="new-document">${icon('plus')}新しい文書<span>Ctrl N</span></button><button id="choose-images">${icon('image')}参照画像のフォルダー</button><button id="theme-button">${icon('moon')}配色を切り替え</button><button id="html-export-button">${icon('code')}HTMLにエクスポート</button><button id="pdf-export-button">${icon('print')}PDFにエクスポート</button><button id="print-button">${icon('print')}印刷</button><button id="install-button" hidden>${icon('download')}アプリをインストール</button><button id="help-button">${icon('help')}ヘルプ・アプリ情報</button></div></details><button class="save-button" id="open-button">${icon('folder')}<span>開く</span></button><button class="primary-button" id="save-button" title="Markdownを保存 (Ctrl+S)" aria-label="Markdownを保存">${icon('save')}<span>保存</span></button></div>
    </header>
    <div class="workspace-toolbar"><div class="view-switch" role="group" aria-label="表示モード"><button id="preview-tab">${icon('eye')}閲覧</button><button id="wysiwyg-tab">${icon('edit')}WYSIWYG</button><button id="source-tab">${icon('code')}Markdown</button></div><div class="reading-tools"><button class="icon-button" id="toggle-outline" title="見出しを切り替え" aria-label="見出しを切り替え" aria-controls="outline" aria-expanded="true">${icon('panel')}</button><button class="text-button remote-button" id="remote-images" aria-pressed="false">外部画像 <span>OFF</span></button><div class="font-controls" role="group" aria-label="文字サイズ"><button id="font-smaller" aria-label="文字を小さく">A−</button><span id="font-size">16</span><button id="font-larger" aria-label="文字を大きく">A＋</button></div></div></div>
    <div class="search-bar" id="search-bar" role="search" hidden>${icon('search')}<input id="search-input" type="search" placeholder="この文書を検索" aria-label="文書内の検索語" /><span id="search-count" aria-live="polite"></span><button class="icon-button" id="search-prev" aria-label="前の検索結果">${icon('up')}</button><button class="icon-button" id="search-next" aria-label="次の検索結果">${icon('down')}</button><button class="icon-button" id="search-close" aria-label="検索を閉じる">${icon('close')}</button></div>
    <div id="temporary-storage" class="temporary-storage" role="status" hidden>この環境では自動復元を利用できません。終了する前にファイルへ保存してください。</div>
    <div class="editing-layout"><aside class="outline" id="outline" aria-label="文書の目次"><div class="outline-heading">見出し</div><nav id="outline-list"></nav></aside><div id="outline-resizer" class="outline-resizer" role="separator" tabindex="0" aria-label="見出しペインの幅" aria-orientation="vertical" aria-controls="outline" title="ドラッグで幅を調整・ダブルクリックで元に戻す"></div><div class="editor-area"><div class="reader-layout"><section class="source-view" id="source-view" aria-label="Markdown編集" hidden><div class="source-note"><span>MARKDOWN</span><button class="text-button" id="copy-source">${icon('copy')}コピー</button></div><textarea id="markdown-input" aria-label="Markdown編集" placeholder="# ここから書きはじめる" spellcheck="false"></textarea></section><div class="document-scroll" id="document-scroll" tabindex="0" aria-label="ドキュメント本文"><div class="document-container"><article class="markdown" id="preview" aria-label="Markdownプレビュー"></article><p id="empty-document" class="empty-document" hidden>「開く」でMarkdownを選ぶか、編集モードで書きはじめてください。</p></div></div></div>${richEditorMarkup}</div></div>
    <footer class="statusbar"><div><span class="status-dot"></span><span id="document-status"></span></div><div class="status-meta"><span id="character-count"></span><span>UTF-8</span><button id="version-button" class="version-button" aria-label="バージョン情報・コピーライト">v${appVersion}${isDesktop ? ' Desktop' : ''}</button></div></footer>
  </main>
  <input id="file-input" type="file" accept=".md,.markdown,.mdown,.mkd,.txt" hidden /><input id="folder-input" type="file" webkitdirectory multiple hidden />
  <div class="toast" id="toast" role="status" hidden></div><div class="drop-overlay" id="drop-overlay" hidden><div>${icon('file')}<h2>Markdownを開く</h2><p>編集するファイルを1つドロップ</p></div></div>
  <dialog id="save-dialog" class="save-dialog" aria-labelledby="save-title"><div class="dialog-heading"><span id="save-title">Markdownを保存</span><button class="icon-button" data-close-dialog aria-label="閉じる">${icon('close')}</button></div><form id="save-form" class="dialog-body"><label class="field-label" for="save-name">ファイル名</label><input id="save-name" class="text-input" required maxlength="120" /><p class="save-note">画像のパスとMermaid記法をそのまま保存します。画像と図を含めて共有する場合はHTML・PDFにエクスポートしてください。</p><p id="save-error" class="form-error" role="alert" hidden></p><div class="dialog-footer"><button class="text-button" type="button" data-close-dialog>キャンセル</button><button class="primary-button" type="submit" id="confirm-save">保存先を選ぶ</button></div></form></dialog>
  <dialog id="export-dialog" class="save-dialog" aria-labelledby="export-title"><div class="dialog-heading"><span id="export-title">HTMLにエクスポート</span><button class="icon-button" data-close-dialog aria-label="閉じる">${icon('close')}</button></div><form id="export-form" class="dialog-body"><label class="field-label" for="export-name">ファイル名</label><input id="export-name" class="text-input" required maxlength="120" /><p class="save-note">参照画像と、SVGに変換したMermaidを含めて1つのファイルに出力します。${isDesktop ? '外部URLの画像は公開ネットワークから取得します。端末内や社内ネットワークのURLは使えません。' : '外部URLの画像は、ローカルに保存して相対パスで参照してください。'}編集中のMarkdownは変わりません。</p><p id="export-browser-note" class="save-note" hidden>ブラウザーの印刷画面で「PDFに保存」を選択してください。</p><p id="export-error" class="form-error" role="alert" hidden></p><div class="dialog-footer"><button class="text-button" type="button" data-close-dialog>キャンセル</button><button class="primary-button" type="submit" id="confirm-export">エクスポート</button></div></form></dialog>
  <dialog id="unsaved-dialog" class="confirm-dialog" aria-labelledby="unsaved-title"><div class="dialog-heading"><span id="unsaved-title">変更を保存しますか？</span></div><div class="dialog-body"><p>別の文書を開く前に、編集中の文書をファイルへ保存できます。</p><div class="dialog-footer unsaved-actions"><button class="text-button" id="cancel-replace">キャンセル</button><button class="text-button" id="discard-replace">保存せずに続ける</button><button class="primary-button" id="save-replace">保存する</button></div></div></dialog>
  <dialog id="diagram-dialog" class="diagram-dialog"><div class="dialog-heading"><span>Mermaid プレビュー</span><button class="icon-button" data-close-dialog aria-label="閉じる">${icon('close')}</button></div><div id="expanded-diagram"></div></dialog>
  ${appInfoMarkup}
  <div class="update-banner" id="update-banner" hidden><span>新しいバージョンが使えます。</span><button id="update-button">更新する</button><button class="icon-button" id="dismiss-update" aria-label="後で更新">${icon('close')}</button></div>
`;
const preview = $('#preview');
const markdownInput = $<HTMLTextAreaElement>('#markdown-input');
const sourceView = $('#source-view');
const scroller = $('#document-scroll');
const fileInput = $<HTMLInputElement>('#file-input');
const folderInput = $<HTMLInputElement>('#folder-input');
const searchInput = $<HTMLInputElement>('#search-input');
const saveDialog = $<HTMLDialogElement>('#save-dialog');
const openAppInfo = setupAppInfo($<HTMLDialogElement>('#help-dialog'));
setupOutlineResizer(app);
function toast(message: string): void {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('#toast').hidden = true;
  }, 6000);
}
function setTheme(value: Theme): void {
  theme = value;
  document.documentElement.dataset.theme = value;
  writePreference('theme', value);
}
function setFontSize(value: number): void {
  fontSize = Math.max(13, Math.min(22, value));
  document.documentElement.style.setProperty('--reading-size', `${fontSize}px`);
  $('#font-size').textContent = String(fontSize);
  writePreference('fontSize', fontSize);
}
function updateStatus(): void {
  $('#document-name').textContent = current.name;
  $('#dirty-mark').hidden = !dirty;
  $('#character-count').textContent = `${Array.from(current.content).length.toLocaleString()} 文字`;
  $('#document-status').textContent = sessionFailed ? '自動保存できません · ファイルへ保存してください' : sessionWrite || pendingSession ? '自動保存中…' : dirty ? 'このデバイスに自動保存済み · ファイルは未保存' : '編集するファイルは1つだけ';
  document.title = `${dirty ? '● ' : ''}${current.name} — shiori markdown editor`;
}
function sessionSnapshot(): EditorSession {
  const referenced = new Set(referencedImages(current.content).map(source => resolveLocalPath(current.path ?? current.name, source)));
  return {
    document: {
      ...current
    },
    dirty,
    nativeToken: nativeDocument?.token,
    assets: images.getPaths().filter(path => referenced.has(path)).map(path => ({
      path,
      file: images.getFile(path)!
    }))
  };
}
function persist(): Promise<void> {
  if (sessionWrite) return sessionWrite;
  sessionWrite = (async () => {
    while (pendingSession) {
      const snapshot = pendingSession;
      pendingSession = undefined;
      try {
        await saveEditorSession(snapshot);
        sessionFailed = false;
      } catch {
        pendingSession ??= snapshot;
        sessionFailed = true;
        toast('自動保存できません。「保存」でファイルへ保存してください。');
        break;
      }
    }
  })().finally(() => {
    sessionWrite = undefined;
    updateStatus();
  });
  return sessionWrite;
}
function queueSession(): void {
  pendingSession = sessionSnapshot();
  void persist();
  updateStatus();
}
function resolveImage(source: string): string | undefined {
  return images.resolveImage(current.path ?? current.name, source) ?? embeddedImage(source) ?? (allowRemoteImages && /^https?:\/\//i.test(source) ? source : undefined);
}
async function rememberImage(path: string, file: File): Promise<void> {
  images.setFile(path, file);
  try {
    await images.prepareImage(path);
  } catch {/* Invalid SVG stays a placeholder. */}
}
async function loadNativeImages(): Promise<void> {
  const context = nativeDocument;
  const document = current;
  if (!context) return;
  let changed = false;
  for (const source of referencedImages(document.content).slice(0, 100)) {
    const path = resolveLocalPath(document.path ?? document.name, source);
    if (!path || images.getFile(path)) continue;
    const file = await context.image(source);
    if (current.id !== document.id || nativeDocument !== context) return;
    if (file && !images.getFile(path)) {
      await rememberImage(path, file);
      changed = true;
    }
  }
  if (changed && current.id === document.id && nativeDocument === context) {
    richEditor?.refreshImages();
    renderDocument();
    queueSession();
  }
}
async function acceptNativeDocument(value: NativeOpenedDocument): Promise<void> {
  const {
    NativeDocument,
    nativeReaderDocument
  } = await import('./native-document');
  await openDocument(nativeReaderDocument(value), new NativeDocument(value.token));
}
async function chooseDocument(): Promise<void> {
  if (!isDesktop) {
    fileInput.click();
    return;
  }
  if (picking || opening || saving) return;
  picking = true;
  try {
    const {
      pickNativeDocument
    } = await import('./native-document');
    const selected = await pickNativeDocument();
    if (selected) await acceptNativeDocument(selected);
  } catch (error) {
    toast(`ファイルを開けませんでした。${String(error)}`);
  } finally {
    picking = false;
  }
}
function applyEdit(content: string): boolean {
  try {
    validateDocumentContent(content);
  } catch {
    toast(DOCUMENT_SIZE_MESSAGE);
    return false;
  }
  if (current.content === content) return true;
  current = {
    ...current,
    content,
    openedAt: Date.now()
  };
  dirty = true;
  queueSession();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderDocument, 250);
  return true;
}
async function ensureRichEditor(): Promise<void> {
  if (!ready || richEditor && richDocumentId === current.id && richSource === current.content) return;
  const generation = ++richLoad;
  $('#rich-view').setAttribute('aria-busy', 'true');
  try {
    const {
      RichEditor
    } = await import('./rich-editor');
    if (generation !== richLoad || mode !== 'wysiwyg') return;
    richEditor?.destroy();
    richEditor = new RichEditor($('#rich-editor'), $('#rich-toolbar'), current.content, {
      resolve: resolveImage
    }, content => {
      if (generation !== richLoad || mode !== 'wysiwyg') return;
      applyEdit(content);
      richSource = current.content;
      richDocumentId = current.id;
    }, () => toast(DOCUMENT_SIZE_MESSAGE));
    richSource = current.content;
    richDocumentId = current.id;
  } catch {
    toast('編集画面を開けませんでした。Markdownモードをお使いください。');
    setView('source');
  } finally {
    if (generation === richLoad) $('#rich-view').removeAttribute('aria-busy');
  }
}
function setView(view: ViewMode): void {
  const previous = mode;
  mode = view;
  app.dataset.view = mode;
  writePreference('viewMode', mode);
  sourceView.hidden = mode !== 'source';
  $('.reader-layout').hidden = mode === 'wysiwyg';
  $('#rich-view').hidden = mode !== 'wysiwyg';
  for (const item of ['preview', 'source', 'wysiwyg']) {
    $(`#${item}-tab`).classList.toggle('active', mode === item);
    $(`#${item}-tab`).setAttribute('aria-pressed', String(mode === item));
  }
  if (mode === 'wysiwyg') void ensureRichEditor();
  if (previous !== mode) {
    clearSearch();
    $('#editor-feedback').hidden = true;
    renderDocument();
  }
}
function renderDocument(): void {
  clearTimeout(previewTimer);
  const generation = ++renderVersion;
  const localUrls = new Set<string>();
  compiled = compileMarkdown(current.content, {
    allowRemoteImages,
    localImageHint: nativeDocument ? '画像の読み込み中、または参照先が見つかりません。パス・形式・サイズを確認してください。' : undefined,
    resolveImage: source => {
      const url = resolveImage(source);
      if (url?.startsWith('blob:')) localUrls.add(url);
      return url;
    }
  });
  preview.innerHTML = sanitizeMarkdown(compiled.html, localUrls);
  // DOM IDs must not collide with form properties or the editor's controls.
  preview.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading, index) => {
    heading.id = `document-heading-${index}`;
  });
  preview.querySelectorAll('table').forEach(table => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.before(wrap);
    wrap.append(table);
  });
  if (markdownInput.value !== current.content) markdownInput.value = current.content;
  $('#empty-document').hidden = Boolean(current.content.trim());
  $('#outline-list').innerHTML = compiled.headings.map(heading => `<a class="outline-link level-${heading.level}" href="#${encodeURIComponent(heading.id)}" data-heading="${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`).join('') || '<p class="no-headings">見出しを付けると<br>ここに表示されます。</p>';
  $('#remote-images').innerHTML = `外部画像 <span>${allowRemoteImages ? 'ON' : 'OFF'}</span>`;
  $('#remote-images').setAttribute('aria-pressed', String(allowRemoteImages));
  updateStatus();
  diagramsReady = mode !== 'wysiwyg' ? renderDiagrams(preview, compiled.diagrams, theme, () => generation === renderVersion && mode !== 'wysiwyg') : Promise.resolve();
  nativeImageLoad = loadNativeImages();
}
function jumpToHeading(id: string): void {
  const index = compiled.headings.findIndex(heading => heading.id === id);
  const container = mode === 'wysiwyg' ? $('#rich-editor') : preview;
  container.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({
    block: 'start',
    behavior: 'smooth'
  });
  $('#outline-list').querySelectorAll('a').forEach(link => link.classList.toggle('current', link.dataset.heading === id));
}
function toggleOutline(): void {
  app.classList.toggle('outline-hidden');
  $('#toggle-outline').setAttribute('aria-expanded', String(!app.classList.contains('outline-hidden')));
}
function requestSave(): Promise<SaveResult> {
  if (savePromise) return savePromise;
  if (saving) return Promise.resolve('cancelled');
  $<HTMLInputElement>('#save-name').value = exportFileName(current.name, 'md');
  $('#save-error').hidden = true;
  savePromise = new Promise(resolve => {
    resolveSave = resolve;
  });
  saveDialog.showModal();
  $('#confirm-save').focus();
  return savePromise;
}
function finishSave(result: SaveResult): void {
  const resolve = resolveSave;
  resolveSave = undefined;
  savePromise = undefined;
  resolve?.(result);
}
saveDialog.onclose = () => {
  if (!saving && !saveDialog.open) finishSave('cancelled');
};
$('#save-form').onsubmit = event => {
  event.preventDefault();
  if (saving) return;
  const snapshot = {
    ...current
  };
  const name = exportFileName($<HTMLInputElement>('#save-name').value, 'md');
  saving = true;
  $<HTMLButtonElement>('#save-button').disabled = true;
  saveDialog.close();
  // Preserve browser user activation: ask for the destination before conversion.
  void exportTextFile({
    name,
    description: 'Markdownファイル',
    mime: 'text/markdown',
    extensions: ['.md', '.markdown'],
    content: snapshot.content
  }).then(result => {
    if (result !== 'cancelled') {
      if (current.id === snapshot.id && current.content === snapshot.content) {
        current.name = name;
        dirty = false;
        queueSession();
      }
      toast(`Markdown${result === 'saved' ? 'を保存しました' : 'のダウンロードを開始しました'}。`);
    }
    finishSave(result);
  }).catch(error => {
    $('#save-error').textContent = `保存できませんでした。${error instanceof Error ? error.message : String(error)}`;
    $('#save-error').hidden = false;
    saveDialog.showModal();
  }).finally(() => {
    saving = false;
    $<HTMLButtonElement>('#save-button').disabled = false;
    updateStatus();
  });
};
const exportDialog = $<HTMLDialogElement>('#export-dialog');
let exportFormat: 'html' | 'pdf' = 'html';
function requestExport(format: 'html' | 'pdf'): void {
  if (saving || opening || saveDialog.open) return;
  exportFormat = format;
  $<HTMLInputElement>('#export-name').value = exportFileName(current.name, format);
  $('#export-title').textContent = `${format.toUpperCase()}にエクスポート`;
  $('#export-error').hidden = true;
  $('#export-browser-note').hidden = format !== 'pdf' || isDesktop;
  exportDialog.showModal();
  $('#confirm-export').focus();
}
$('#html-export-button').onclick = () => requestExport('html');
$('#pdf-export-button').onclick = () => requestExport('pdf');
$('#export-form').onsubmit = event => {
  event.preventDefault();
  if (saving) return;
  const format = exportFormat;
  const name = exportFileName($<HTMLInputElement>('#export-name').value, format);
  const snapshot = {
    ...current
  };
  const nativeSnapshot = nativeDocument;
  const files = new Map(images.getPaths().map(path => [path, images.getFile(path)!]));
  let output: HtmlDocument | undefined;
  const content = async () => {
    output = await buildHtmlDocument(snapshot.content, {
      title: name.replace(/\.(html|pdf)$/i, ''),
      resolveImageFile: source => files.get(resolveLocalPath(snapshot.path ?? snapshot.name, source) ?? '') ?? nativeSnapshot?.image(source)
    });
    return output.content;
  };
  saving = true;
  $<HTMLButtonElement>('#save-button').disabled = true;
  exportDialog.close();
  toast(`${format.toUpperCase()}を作成しています…`);
  const job = format === 'pdf' ? exportPdfFile(name, content) : exportTextFile({
    name,
    description: 'HTMLファイル',
    mime: 'text/html',
    extensions: ['.html'],
    content
  });
  void job.then(result => {
    if (result === 'print-dialog') toast('印刷画面で「PDFに保存」を選択してください。');else if (result !== 'cancelled') toast(`${format.toUpperCase()}${result === 'saved' ? 'を保存しました' : 'のダウンロードを開始しました'}（画像 ${output?.images ?? 0}個・Mermaid ${output?.diagrams ?? 0}個）。`);
  }).catch(error => {
    $('#export-error').textContent = `エクスポートできませんでした。${error instanceof Error ? error.message : String(error)}`;
    $('#export-error').hidden = false;
    exportDialog.showModal();
  }).finally(() => {
    saving = false;
    $<HTMLButtonElement>('#save-button').disabled = false;
    updateStatus();
  });
};
async function mayReplace(): Promise<boolean> {
  if (!dirty) return true;
  const dialog = $<HTMLDialogElement>('#unsaved-dialog');
  const choice = await new Promise<'save' | 'discard' | 'cancel'>(resolve => {
    const finish = (value: 'save' | 'discard' | 'cancel') => {
      dialog.close();
      resolve(value);
    };
    $('#cancel-replace').onclick = () => finish('cancel');
    $('#discard-replace').onclick = () => finish('discard');
    $('#save-replace').onclick = () => finish('save');
    dialog.oncancel = () => resolve('cancel');
    dialog.showModal();
    $('#cancel-replace').focus();
  });
  if (choice === 'discard') return true;
  if (choice !== 'save' || (await requestSave()) === 'cancelled') return false;
  if (dirty) {
    toast('保存中に加わった変更があります。保存してから文書を切り替えてください。');
    return false;
  }
  return true;
}
async function openDocument(doc: ReaderDocument, context?: NativeDocument): Promise<boolean> {
  if (opening || saving) {
    void context?.close().catch(() => {});
    toast('保存が完了してから文書を開いてください。');
    return false;
  }
  opening = true;
  let accepted = false;
  try {
    validateDocumentContent(doc.content);
    if (!(await mayReplace())) return false;
    ++richLoad;
    clearTimeout(previewTimer);
    await persist();
    const previousContext = nativeDocument;
    if (isDesktop && (context || previousContext)) {
      const {
        rememberNativeDocument
      } = await import('./native-document');
      try {
        await rememberNativeDocument(context?.token);
      } catch {
        toast('文書の場所を保存できませんでした。再起動後は「開く」から選び直してください。');
      }
    }
    nativeDocument = context;
    void previousContext?.close().catch(() => {});
    richEditor?.destroy();
    richEditor = undefined;
    richSource = undefined;
    richDocumentId = undefined;
    current = doc;
    accepted = true;
    dirty = false;
    allowRemoteImages = false;
    images.dispose();
    clearSearch();
    renderDocument();
    setView(mode);
    scroller.scrollTop = 0;
    queueSession();
    return true;
  } finally {
    if (!accepted) void context?.close().catch(() => {});
    opening = false;
  }
}
async function openFiles(files: File[]): Promise<void> {
  const documents = files.filter(file => isMarkdownFile(file.name));
  if (documents.length !== 1) {
    toast('編集するMarkdownファイルを1つ選択してください。');
    return;
  }
  try {
    if (await openDocument(await readDocument(documents[0]))) {
      for (const file of files) if (isImageFile(file.name)) await rememberImage(file.webkitRelativePath || file.name, file);
      richEditor?.refreshImages();
      renderDocument();
      queueSession();
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : 'ファイルを開けませんでした。');
  }
}
function clearSearch(): void {
  for (const mark of searchMarks) {
    const parent = mark.parentNode;
    if (parent) {
      mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
      parent.normalize();
    }
  }
  searchMarks = [];
  searchIndex = -1;
  editMatches = [];
}
function runSearch(): void {
  clearSearch();
  const term = searchInput.value.trim().toLowerCase();
  if (!term) {
    $('#search-count').textContent = '検索語を入力';
    return;
  }
  if (mode !== 'preview') {
    if (mode === 'wysiwyg') editMatches = richEditor?.find(term) ?? [];else {
      const text = markdownInput.value.toLowerCase();
      for (let index = text.indexOf(term); index !== -1 && editMatches.length < 500; index = text.indexOf(term, index + term.length)) editMatches.push({
        from: index,
        to: index + term.length
      });
    }
    if (editMatches.length) moveSearch(1, false);else $('#search-count').textContent = '一致なし';
    return;
  }
  const root = preview;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('svg,button,figcaption,.diagram-content,.image-placeholder') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.textContent ?? '';
    const lower = text.toLowerCase();
    if (!lower.includes(term)) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    let start: number;
    while (searchMarks.length < 500 && (start = lower.indexOf(term, offset)) !== -1) {
      fragment.append(document.createTextNode(text.slice(offset, start)));
      const mark = document.createElement('mark');
      mark.className = 'search-match';
      mark.textContent = text.slice(start, start + term.length);
      fragment.append(mark);
      searchMarks.push(mark);
      offset = start + term.length;
    }
    fragment.append(document.createTextNode(text.slice(offset)));
    node.replaceWith(fragment);
    if (searchMarks.length >= 500) break;
  }
  if (searchMarks.length) moveSearch(1);else $('#search-count').textContent = '一致なし';
}
function moveSearch(direction: number, focus = true): void {
  if (mode !== 'preview') {
    if (!editMatches.length) return;
    searchIndex = (searchIndex + direction + editMatches.length) % editMatches.length;
    const range = editMatches[searchIndex];
    if (mode === 'wysiwyg') richEditor?.selectRange(range, focus);else {
      if (focus) markdownInput.focus();
      markdownInput.setSelectionRange(range.from, range.to);
    }
    $('#search-count').textContent = `${searchIndex + 1} / ${editMatches.length}${editMatches.length === 500 ? '+' : ''}`;
    return;
  }
  if (!searchMarks.length) return;
  searchMarks[searchIndex]?.classList.remove('current-match');
  searchIndex = (searchIndex + direction + searchMarks.length) % searchMarks.length;
  searchMarks[searchIndex].classList.add('current-match');
  searchMarks[searchIndex].scrollIntoView({
    block: 'center',
    behavior: 'smooth'
  });
  $('#search-count').textContent = `${searchIndex + 1} / ${searchMarks.length}${searchMarks.length === 500 ? '+' : ''}`;
}
function openSearch(): void {
  $('#search-bar').hidden = false;
  searchInput.focus();
  searchInput.select();
}
function closeSearch(): void {
  $('#search-bar').hidden = true;
  clearTimeout(searchTimer);
  clearSearch();
  $('#search-button').focus();
}
function runEditorCommand(label: string, command: () => boolean): boolean {
  try {
    if (command()) {
      $('#editor-feedback').hidden = true;
      return true;
    }
  } catch {/* Recoverable editor error. */}
  $('#editor-feedback-message').textContent = `「${label}」を適用できませんでした。編集する場所を選択して、もう一度お試しください。`;
  $('#editor-feedback').hidden = false;
  return false;
}
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました。');
  } catch {
    toast('コピーできませんでした。Markdownモードでテキストを選択してください。');
  }
}
$('#open-button').onclick = () => {
  void chooseDocument();
};
fileInput.onchange = () => {
  const files = Array.from(fileInput.files ?? []);
  fileInput.value = '';
  if (files.length) void openFiles(files);
};
$('#choose-images').onclick = () => folderInput.click();
folderInput.onchange = async () => {
  const files = Array.from(folderInput.files ?? []);
  folderInput.value = '';
  if (!files.length) return;
  if (opening || saving) {
    toast('現在の処理が完了してから画像フォルダーを選択してください。');
    return;
  }
  opening = true;
  const previousInert = app.inert;
  app.inert = true;
  try {
    const {
      selectFolderImages
    } = await import('./folder-images');
    const document = current;
    const selection = selectFolderImages(files, current, referencedImages(current.content));
    if (current !== document) return;
    if (!selection.assets.length) {
      toast('参照している画像が見つかりません。Markdownと画像を含むフォルダーを選択してください。');
      return;
    }
    // A manual folder selection establishes a new base; never mix native paths.
    const previousContext = nativeDocument;
    nativeDocument = undefined;
    if (previousContext) {
      const {
        rememberNativeDocument
      } = await import('./native-document');
      await rememberNativeDocument().catch(() => {});
      void previousContext.close().catch(() => {});
    }
    images.dispose();
    current.path = selection.base;
    for (const asset of selection.assets) await rememberImage(asset.path, asset.file);
    richEditor?.refreshImages();
    renderDocument();
    queueSession();
    toast('参照画像のフォルダーを設定しました。');
  } catch {
    toast('画像フォルダーを読み込めませんでした。');
  } finally {
    opening = false;
    app.inert = previousInert;
  }
};
$('#save-button').onclick = () => {
  void requestSave();
};
$('#new-document').onclick = () => {
  void openDocument(newDocument()).then(opened => {
    if (opened) setView('wysiwyg');
  });
};
$('#theme-button').onclick = () => {
  setTheme(theme === 'light' ? 'dark' : 'light');
  renderDocument();
};
$('#toggle-outline').onclick = toggleOutline;
$('#font-smaller').onclick = () => setFontSize(fontSize - 1);
$('#font-larger').onclick = () => setFontSize(fontSize + 1);
$('#preview-tab').onclick = () => setView('preview');
$('#source-tab').onclick = () => setView('source');
$('#wysiwyg-tab').onclick = () => setView('wysiwyg');
$('#remote-images').onclick = () => {
  allowRemoteImages = !allowRemoteImages;
  richEditor?.refreshImages();
  renderDocument();
};
const acceptSourceEdit = () => {
  if (!applyEdit(markdownInput.value)) markdownInput.value = current.content;
};
markdownInput.addEventListener('input', event => {
  if (!(event as InputEvent).isComposing) acceptSourceEdit();
});
markdownInput.addEventListener('compositionend', acceptSourceEdit);
$('#copy-source').onclick = () => {
  void copy(current.content);
};
$('#search-button').onclick = openSearch;
$('#search-close').onclick = closeSearch;
$('#search-prev').onclick = () => moveSearch(-1);
$('#search-next').onclick = () => moveSearch(1);
searchInput.oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 120);
};
searchInput.onkeydown = event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    moveSearch(event.shiftKey ? -1 : 1);
  }
};
$('#help-button').onclick = () => openAppInfo('help');
$('#version-button').onclick = () => openAppInfo('about');
$('#print-button').onclick = async () => {
  setView('preview');
  renderDocument();
  const generation = renderVersion;
  await diagramsReady;
  if (generation === renderVersion) window.print();
};
$('#rich-toolbar').addEventListener('mousedown', event => {
  if ((event.target as Element).closest('button')) event.preventDefault();
});
$('#rich-toolbar').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-rich-action]');
  if (!button || !richEditor) return;
  const action = button.dataset.richAction!;
  if (action === 'link' || action === 'image') {
    const dialog = $<HTMLDialogElement>('#insert-dialog');
    dialog.dataset.type = action;
    $('#insert-title').textContent = action === 'image' ? '画像を挿入' : 'リンクを挿入';
    $('#insert-label-label').textContent = action === 'image' ? '画像の説明' : '表示テキスト';
    $<HTMLInputElement>('#insert-source').value = '';
    $<HTMLInputElement>('#insert-label').value = richEditor.getSelectedText();
    dialog.showModal();
    $('#insert-source').focus();
  } else runEditorCommand(button.getAttribute('aria-label') ?? action, () => richEditor!.action(action));
  $<HTMLDetailsElement>('.table-menu').open = false;
});
$<HTMLSelectElement>('#block-style').onchange = event => runEditorCommand('段落の書式', () => richEditor!.setBlock((event.target as HTMLSelectElement).value));
$('#dismiss-editor-feedback').onclick = () => {
  $('#editor-feedback').hidden = true;
};
$('#insert-form').onsubmit = event => {
  event.preventDefault();
  const dialog = $<HTMLDialogElement>('#insert-dialog');
  const source = $<HTMLInputElement>('#insert-source').value.trim();
  if (source && runEditorCommand('挿入', () => richEditor!.insert(dialog.dataset.type as 'link' | 'image', source, $<HTMLInputElement>('#insert-label').value.trim()))) dialog.close();
};
app.addEventListener('click', async event => {
  const target = event.target as Element;
  if (target.closest('.file-menu-items button')) $<HTMLDetailsElement>('#file-menu').open = false;
  const close = target.closest('[data-close-dialog]');
  if (close) close.closest('dialog')?.close();
  const heading = target.closest<HTMLElement>('[data-heading]');
  if (heading) {
    event.preventDefault();
    jumpToHeading(heading.dataset.heading!);
    return;
  }
  const code = target.closest('[data-copy-code]');
  if (code) void copy(code.closest('.code-block')?.querySelector('code')?.textContent ?? '');
  const svgButton = target.closest<HTMLButtonElement>('[data-save-diagram]');
  if (svgButton && !svgButton.disabled) {
    const index = compiled.diagrams.findIndex(diagram => diagram.id === svgButton.closest<HTMLElement>('[data-diagram]')?.dataset.diagram);
    const source = compiled.diagrams[index]?.source;
    if (!source) return;
    svgButton.disabled = true;
    try {
      const result = await exportTextFile({
        name: exportFileName(current.name, 'svg').replace(/\.svg$/, `-diagram-${index + 1}.svg`),
        description: 'SVG画像',
        mime: 'image/svg+xml',
        extensions: ['.svg'],
        content: async () => `<?xml version="1.0" encoding="UTF-8"?>\n${await renderDiagramSvg(source, 'light')}\n`
      });
      if (result !== 'cancelled') toast('SVGを保存しました。');
    } catch (error) {
      toast(`SVGを保存できませんでした。${error instanceof Error ? error.message : ''}`);
    } finally {
      svgButton.disabled = false;
    }
  }
  const expand = target.closest('[data-expand-diagram]');
  if (expand) {
    const svg = expand.closest('.diagram-card')?.querySelector('svg');
    if (svg) {
      const owner = svg.parentElement!;
      $('#expanded-diagram').replaceChildren(svg);
      const dialog = $<HTMLDialogElement>('#diagram-dialog');
      dialog.onclose = () => {
        if (owner.isConnected) owner.append(svg);else svg.remove();
      };
      dialog.showModal();
    }
  }
  const link = target.closest<HTMLAnchorElement>('a[href]');
  const href = link?.getAttribute('href') ?? '';
  if (link?.dataset.localLink) {
    event.preventDefault();
    toast('別の文書は「開く」から選択してください。');
  } else if (isDesktop && /^(?:https?:\/\/|mailto:)/i.test(href)) {
    event.preventDefault();
    try {
      await openExternalLink(link!.href);
    } catch {
      toast('外部リンクを開けませんでした。');
    }
  } else if (link?.closest('#preview') && href.startsWith('#')) {
    event.preventDefault();
    try {
      jumpToHeading(decodeURIComponent(href.slice(1)));
    } catch {/* Invalid fragment. */}
  }
});
document.addEventListener('click', event => {
  if (!(event.target as Element).closest('#file-menu')) $<HTMLDetailsElement>('#file-menu').open = false;
});
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog && dialog.id !== 'unsaved-dialog') {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'F1') { event.preventDefault(); openAppInfo('help'); return; }
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (['o', 's', 'n', 'f', '\\'].includes(key)) event.preventDefault();
    if (key === 'o') void chooseDocument();
    if (key === 's') void requestSave();
    if (key === 'n') $('#new-document').click();
    if (key === 'f') openSearch();
    if (key === '\\') toggleOutline();
  }
  if (event.key === 'Escape') {
    if (!$('#search-bar').hidden) closeSearch();
    $<HTMLDetailsElement>('#file-menu').open = false;
  }
});
let dragDepth = 0;
document.addEventListener('dragenter', event => {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault();
    dragDepth++;
    $('#drop-overlay').hidden = false;
  }
});
document.addEventListener('dragover', event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) $('#drop-overlay').hidden = true;
});
document.addEventListener('drop', event => {
  if (event.dataTransfer?.files.length) {
    event.preventDefault();
    dragDepth = 0;
    $('#drop-overlay').hidden = true;
    if (!isDesktop) void openFiles(Array.from(event.dataTransfer.files));
  }
});
window.addEventListener('beforeunload', event => {
  if (sessionWrite || pendingSession || usesTemporaryStorage() && dirty || exportJobs.busy) {
    event.preventDefault();
    event.returnValue = '';
  }
});
if (isDesktop && '__TAURI_INTERNALS__' in window) {
  void import('@tauri-apps/api/event').then(async ({
    listen
  }) => {
    await listen<NativeOpenedDocument>('document-opened', event => {
      void acceptNativeDocument(event.payload).catch(error => toast(`ファイルを開けませんでした。${String(error)}`));
    });
    await listen<string>('document-open-error', event => toast(event.payload));
  }).catch(() => toast('ドラッグ＆ドロップを準備できませんでした。「開く」を使用してください。'));
  void import('@tauri-apps/api/window').then(async ({
    getCurrentWindow
  }) => {
    let closing = false;
    const nativeWindow = getCurrentWindow();
    await nativeWindow.onCloseRequested(async event => {
      event.preventDefault();
      if (closing) return;
      closing = true;
      app.inert = true;
      try {
        if (!(await exportJobs.shutdown())) {
          toast('ファイルの保存に失敗したため、終了を中止しました。');
          return;
        }
        await nativeImageLoad;
        await persist();
        if (pendingSession || sessionFailed || usesTemporaryStorage() && dirty) {
          const {
            confirm
          } = await import('@tauri-apps/plugin-dialog');
          if (!(await confirm('自動保存できていない編集があります。ファイルへ保存せずに終了しますか。', {
            title: 'shiori',
            kind: 'warning',
            okLabel: '終了する',
            cancelLabel: '編集に戻る'
          }))) return;
        }
        await nativeWindow.destroy();
      } catch {
        toast('保存を確認できませんでした。ファイルへ保存してから終了してください。');
      } finally {
        exportJobs.resume();
        app.inert = false;
        closing = false;
      }
    });
  }).catch(() => toast('終了時の保存確認を設定できませんでした。終了前にファイルへ保存してください。'));
}
let installPrompt: Event & {
  prompt(): Promise<void>;
} | undefined;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  if (!isDesktop && !isPortable) {
    installPrompt = event as typeof installPrompt;
    $('#install-button').hidden = false;
  }
});
$('#install-button').onclick = () => {
  void installPrompt?.prompt();
};
const updateSW = isDesktop || isPortable ? async (_reload?: boolean) => {} : registerSW({
  immediate: true,
  onNeedRefresh: () => {
    $('#update-banner').hidden = false;
  }
});
$('#update-button').onclick = async () => {
  await persist();
  if (!pendingSession) void updateSW(true);
};
$('#dismiss-update').onclick = () => {
  $('#update-banner').hidden = true;
};
app.inert = true;
setTheme(theme);
setFontSize(fontSize);
if (matchMedia('(max-width: 760px)').matches) toggleOutline();
try {
  const restored = await loadEditorSession();
  if (restored) {
    validateDocumentContent(restored.document.content);
    current = restored.document;
    dirty = restored.dirty;
    for (const asset of restored.assets) await rememberImage(asset.path, asset.file);
    if (isDesktop && restored.nativeToken) {
      const {
        resumeNativeDocument
      } = await import('./native-document');
      try {
        nativeDocument = await resumeNativeDocument(restored.nativeToken);
      } catch {
        toast('参照画像の場所を復元できませんでした。Markdownを「開く」から選び直してください。');
      }
    }
  }
} catch {
  toast('前回の文書を復元できませんでした。「開く」からファイルを選んでください。');
}
ready = true;
$('#temporary-storage').hidden = !usesTemporaryStorage();
renderDocument();
setView(mode);
app.inert = false;
app.dataset.ready = 'true';
