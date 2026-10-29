import { version } from '../package.json';
import shioriMark from '../assets/branding/shiori-mark-256.png?inline';
import { icon } from './icons';
import { escapeHtml } from './markdown';
import { isDesktop } from './platform';

type InfoTab = 'about' | 'privacy' | 'help';
const edition = isDesktop ? 'Windows デスクトップ版' : import.meta.env.MODE === 'portable' ? '単一HTML版' : 'Web / PWA版';

export const appInfoMarkup = `
  <dialog id="help-dialog" class="help-dialog" aria-labelledby="help-title">
    <div class="dialog-heading"><span id="help-title">ヘルプ・アプリ情報</span><button class="icon-button" data-close-dialog aria-label="閉じる">${icon('close')}</button></div>
    <div class="info-tabs" role="tablist" aria-label="ヘルプ・アプリ情報">
      <button id="info-tab-about" role="tab" aria-controls="info-about" aria-selected="true">アプリ情報</button>
      <button id="info-tab-privacy" role="tab" aria-controls="info-privacy" aria-selected="false" tabindex="-1">プライバシー</button>
      <button id="info-tab-help" role="tab" aria-controls="info-help" aria-selected="false" tabindex="-1">使い方</button>
    </div>
    <div class="info-content">
      <section id="info-about" class="dialog-body info-about" role="tabpanel" aria-labelledby="info-tab-about" tabindex="0">
        <img class="info-logo" src="${shioriMark}" alt="shioriのロゴ" width="180" height="180" />
        <h2>shiori markdown editor <span>${escapeHtml(version)}</span></h2>
        <p class="info-tagline">ひとつの文書に、集中する。<br />Markdownを読む・書くためのエディタ</p>
        <p class="info-edition">${edition}</p>
        <p class="info-copyright">Copyright © 2026 テバ開発</p>
        <p>発行元：テバ開発</p>
        <details class="info-licenses"><summary>外部ライブラリについて</summary><p>shioriはTauri、TipTap、Mermaid、Markdown-it、DOMPurifyなどのオープンソースソフトウェアを使用しています。それぞれの著作権とライセンスは各権利者に帰属します。ライセンス全文は配布物に同梱の第三者ライセンス文書（THIRD-PARTY-*）に記載しています。</p></details>
      </section>
      <section id="info-privacy" class="dialog-body" role="tabpanel" aria-labelledby="info-tab-privacy" tabindex="0" hidden>
        <h2>プライバシーに関する通知</h2>
        <p>shioriは、選択したMarkdownと参照画像をこのデバイス内で処理します。文章・画像・下書きを開発者のサーバーへ送信する機能、アクセス解析、広告機能はありません。</p>
        <h3>デバイスに保存するもの</h3>
        <p>編集中の文書、参照画像、表示設定をアプリまたはブラウザーの保存領域に保持し、次回起動時に復元します。Windows版では参照画像を読み取るため、選択した文書や画像フォルダーの場所も保持します。元のMarkdownは「保存」するまで変更しません。</p>
        <p>別の文書を開くと自動復元の対象が置き換わります。旧版の保存データは自動では削除しません。保存領域の消去はWindowsのアプリ管理またはブラウザーのサイトデータ設定から行えます。消去前に必要な文書をファイルへ保存してください。書き出したファイルは別途ご自身で管理してください。</p>
        <h3>通信が発生する操作</h3>
        <p>外部画像の表示は初期状態ではOFFです。ONにすると画像配信元へ通信します。Windows版のHTML・PDFエクスポートでは、表示のON/OFFにかかわらず本文の外部画像を取得します。配信元にはIPアドレスなどの通信情報が伝わります。Web / PWA / 単一HTML版のエクスポートでは外部画像を自動取得しません。</p>
        <p>Windows版のエクスポートでは端末内・内部ネットワークのURLを拒否し、Cookie・認証情報・リファラー・プロキシを使わずに取得します。Mermaidの描画では外部通信を行いません。</p>
        <p>外部リンクを選ぶとブラウザーやメールアプリが開き、移動先のサービスのプライバシーポリシーが適用されます。Web / PWA版の読み込み・更新ではアプリの配信元と通信します。Microsoft Storeによる配布・更新、WebView2の動作にはMicrosoftの規約・プライバシー情報が適用されます。</p>
        <h3>エクスポートした文書</h3>
        <p>HTML・PDFには本文、参照画像、Mermaidから生成した図が含まれます。生成処理はデバイス内で行います。共有前に内容をご確認ください。</p>
        <p class="info-policy-date">発行元：テバ開発 · 更新日：2026年10月29日</p>
      </section>
      <section id="info-help" class="dialog-body" role="tabpanel" aria-labelledby="info-tab-help" tabindex="0" hidden>
        <h2>shiori の使い方</h2>
        <h3>文書を開く・編集する</h3>
        <p>「開く」またはファイルのドラッグ＆ドロップでMarkdownを1つ選びます。「閲覧」「WYSIWYG」「Markdown」を切り替えて編集できます。編集中の文書はこのデバイスに自動保存され、次回起動時に復元します。元のファイルへの反映には「保存」を使います。</p>
        <h3>見出しペイン</h3>
        <p>左の見出しを選ぶと、その場所へ移動します。本文との境界線を左右にドラッグすると幅を変えられます。幅は次回起動時にも復元します。境界線をダブルクリックすると標準の幅に戻ります。キーボードでは境界線にTabで移動し、← / →で調整、Home / Endで最小 / 最大にできます。上部の見出しボタンで表示を切り替えられます。</p>
        <h3>参照画像を表示する</h3>
        <p>Windows版はMarkdownと同じフォルダー配下の画像を相対パスで読み込みます。Web版や上位フォルダーの画像は「その他 → 参照画像のフォルダー」で、Markdownと画像を含むフォルダーを選びます。外部URLの画像は「外部画像」をONにすると表示します。</p>
        <h3>保存・共有する</h3>
        <p>「保存」は画像のパスとMermaid記法をそのままMarkdownに保存します。「その他 → HTMLにエクスポート / PDFにエクスポート」で画像と図を含めた文書を出力できます。HTMLはオフラインで開ける単一ファイル、PDFはA4です。Web / PWA / 単一HTML版のPDFは印刷画面で「PDFに保存」を選択します。エクスポートしてもMarkdownの未保存状態は変わりません。</p>
        <p>外部画像を含むWindows版のエクスポートには通信が必要です。Web / PWA / 単一HTML版では画像をローカルに保存して相対パスで参照してください。画像の破損や図の構文エラーがある場合は出力を中止します。</p>
        <h3>文書の上限</h3>
        <p>Markdownの読み込み・編集・保存はUTF-8で2 MBまでです。HTML出力は64 MBまで、参照画像は1枚8 MB・合計32 MBまでです。</p>
        <dl class="shortcut-list"><div><dt>開く</dt><dd><kbd>Ctrl</kbd><kbd>O</kbd></dd></div><div><dt>保存</dt><dd><kbd>Ctrl</kbd><kbd>S</kbd></dd></div><div><dt>新規</dt><dd><kbd>Ctrl</kbd><kbd>N</kbd></dd></div><div><dt>検索</dt><dd><kbd>Ctrl</kbd><kbd>F</kbd></dd></div><div><dt>見出しペインの表示切替</dt><dd><kbd>Ctrl</kbd><kbd>&#92;</kbd></dd></div><div><dt>ヘルプ</dt><dd><kbd>F1</kbd></dd></div></dl>
      </section>
    </div>
    <div class="info-footer"><button class="save-button" data-close-dialog>閉じる</button></div>
  </dialog>`;

export function setupAppInfo(dialog: HTMLDialogElement): (tab: InfoTab) => void {
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  let returnFocus: HTMLElement | undefined;
  dialog.addEventListener('close', () => returnFocus?.focus());
  function selectTab(selected: HTMLButtonElement): void {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      dialog.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)!.hidden = !active;
    }
    dialog.querySelector('.info-content')!.scrollTop = 0;
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  }
  return tab => {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement
      ? active.closest('details')?.querySelector('summary') ?? active : undefined;
    const selected = tabs.find(button => button.id === `info-tab-${tab}`)!;
    selectTab(selected);
    dialog.showModal();
    selected.focus();
  };
}
