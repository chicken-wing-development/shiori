# shiori markdown editor 1.0.0

1つのMarkdownファイルを開いて編集・保存するアプリです。Rust + Tauri 2のWindows版、Web / PWA版、アプリ全体を配布する単一HTML版を共通のTypeScriptソースから生成します。文書をサーバーへアップロードする機能はありません。

## 編集と保存

「開く」でファイルを1つ選び、閲覧・WYSIWYG・Markdownを切り替えます。左側には見出しだけを表示し、ボタンで隠せます。本文との境界線をドラッグすると幅を調整でき、次回起動時にも復元します。ダブルクリックで標準幅に戻せます。境界線にTabで移動し、左右キー（Shift併用で大きく変更）やHome / Endでも調整できます。狭いウィンドウでは本文の編集領域を残す幅に収めます。

ファイル一覧、フォルダーの管理、履歴一覧はありません。新規作成、画像フォルダー指定、HTML・PDF出力、配色、印刷は「その他」にまとめています。「その他 → ヘルプ・アプリ情報」またはF1で使い方を表示します。同じ画面のタブからプライバシー通知とコピーライトを確認できます。画面右下のバージョン表示を選ぶと、ロゴ・バージョン・発行元「テバ開発」のアプリ情報を直接開きます。問い合わせ先は掲載していません。

「保存」（Ctrl+S）はMarkdownの本文をそのまま保存します。画像パスやMermaid記法を変換するオプションはありません。既存の埋め込み済みMarkdownも読み込めます。

「その他 → HTMLにエクスポート」は、参照画像とMermaidから生成したSVGを含む単一HTMLを出力します。スタイルも内蔵し、配布先で画像フォルダーやMermaidの実行環境、通信を必要としません。コードブロック・表・見出しリンクも含む文書全体を出力します。

「その他 → PDFにエクスポート」は同じ内容をA4のPDFとして出力します。Windows版は保存先の選択後にWebView2で生成します。Web / PWA / 単一HTMLアプリ版はブラウザーの印刷画面で「PDFに保存」を選択してください。PDF・HTMLの出力で、元のMarkdownや未保存状態は変わりません。図だけの「SVG保存」も利用できます。

Windows版では「開く」・Ctrl+O・ドラッグ＆ドロップで選択したMarkdownの場所をRust側で保持し、`./img/sharp1.png`など同じフォルダー配下の画像を自動で読み込みます。日本語・空白のURLエンコード、参照形式の画像、SVGにも対応します。SVGは表示前にサニタイズします。参照画像は1枚8 MiB・合計32 MiB・100個までです。

Web / PWA / 単一HTML版や、Markdownより上のフォルダーにある画像は「その他 → 参照画像のフォルダー」で**Markdownと画像の共通の親フォルダー**を指定してください。`img`フォルダーだけを選んだ場合も、その名前を含む参照を解決します。Markdownを別のフォルダーへ移す場合は画像も同じ相対位置へコピーしてください。文書を1ファイルで共有する場合はHTMLまたはPDFへ出力します。

Windows版でHTML・PDF出力に外部URLの画像を含める場合は、Rust側で名前解決した全IPが公開アドレスであることを確認し、そのIPに接続先を固定して取得します。内部ネットワーク、localhost、特殊用途アドレス、リダイレクトを拒否し、プロキシ・Cookie・認証情報・リファラーは使用しません。ブラウザー版（Web / PWA / 単一HTML）は接続先IPを確実に検証できないため外部URL画像の自動取得を行いません。画像をローカルに保存し、相対パスで参照してください。

MarkdownはUTF-8で2 MiBまでです。HTML・PDF出力は画像100個・Mermaid 30図、参照画像1枚8 MiB・合計32 MiB、生成HTML 64 MiB、PDF 128 MiBまでです。画像は実データ形式とデコード可否を確認し、1枚32メガピクセルまでとします。スキーム省略リンク（`//example.com/path`）はHTTPSへ変換します。画像が見つからない・壊れている、図に構文エラーがある、上限を超える場合はエクスポートを中止し、保存先の既存ファイルを保持します。通常のMarkdown保存では画像の読み込みや図の変換を必要としません。

編集中の1文書とその参照画像を端末内へ自動保存し、次回起動で復元します。別の文書を開く・新規作成する前には、未保存の変更を保存するか確認します。旧版からは最後に開いていた文書と下書きを復元し、旧ワークの保存データ自体は削除しません。自動保存領域が利用できない環境では画面に通知するため、終了前にファイルへ保存してください。

検索、文字サイズ、ダークモード、印刷・PDF保存、表・タスクリスト・コードの色分け、WYSIWYGの書式設定とUndo / Redoを利用できます。MermaidはWYSIWYGで記法を編集し、閲覧またはMarkdownモードで図を確認します。

## Windows版のビルド

タスクバー・実行ファイル・Store・Web/PWA用のアイコンには、読書する人物をしおりの枠に配置した簡易版を使用します。アプリ内のロゴとは分けて管理し、`pnpm icons`で採用画像から各サイズを再生成できます。元画像と生成方法は[アイコン素材の説明](assets/branding/README.md)を参照してください。

Windows 11、Node.js 22.12以上、pnpm 11.25.0、Rust 1.98以上、Visual Studio C++ Build Tools、Windows SDK、WebView2 Runtimeを使用します。ARM64向けにはC++ ARM64ビルドツールも必要です。

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:build --target aarch64-pc-windows-msvc -- --locked
pnpm desktop:build --target x86_64-pc-windows-msvc -- --locked
```

生成先は`src-tauri/target/<target>/release/shiori-markdown.exe`です。`dist-desktop/`の画面を実行ファイルへ内蔵します。Markdown・HTML・PDF・SVGの保存にはWindowsの保存ダイアログを使用します。デスクトップ版はService Workerを使いません。

Microsoft Store用MSIXと正式なアプリIDの設定は[Windows配布手順](docs/WINDOWS-RELEASE.md)を参照してください。バージョンは1.0.0ですが、Storeへの提出・公開は別途必要です。

## Web / PWA・単一HTMLアプリ

```sh
pnpm dev
pnpm build
pnpm preview
pnpm build:portable
```

`dist/`をHTTPSのサイトルートに配置するとPWAとして使用できます。Service Workerは本番ビルドで有効です。初回オンライン起動後にオフライン利用できます。

`portable/shiori.html`は**アプリ全体**を単一ファイルで配布するためのものです。PCへダウンロードし、Edge / Chromeで開きます。Markdown・Mermaid・編集ライブラリー・アイコンを内蔵し、Node.jsやWebサーバーは不要です。ローカルHTMLの保存はファイルのダウンロードを使います。自動復元はブラウザーとファイルの場所に依存するため、大切な編集はMarkdownへ保存してください。

`pnpm build:all`でNodeテスト・型検査・PWA・単一HTMLのビルドをまとめて実行できます。`pnpm release`はさらにPWA・単一HTML・ソース・開発モジュール同梱版を`releases/v1.0.0/`へまとめます。Windows実行ファイルとMSIXは`desktop:build`・`store:pack`で別途作成します。

## セキュリティ境界と検証

- Mermaidは`allow-scripts`のみのsandbox iframeで描画し、CSPで通信と親画面・Tauri IPCへのアクセスを遮断します。描画結果と読み込んだSVGはサニタイズします。`allow-same-origin`や外部通信権限を追加しないでください。
- 入力・通常編集・WYSIWYG・Markdown保存は共通のUTF-8サイズ検証を使います。超過した編集は確定せず、直前の内容を保持します。Rust側でも上限を検証します。
- ネイティブ保存はRustのダイアログで選んだ保存先に、一度限りのチケットで書き込みます。フロントエンドに任意パス書き込みAPIは公開しません。同じフォルダーの一時ファイルへ書き込み・同期した後に置換し、失敗時は元ファイルを保持します。
- Rustの読み取りもユーザーが選択した文書に紐づくIDで行います。絶対パス、UNC、デバイス名、フォルダー外へ出るパスを拒否し、Windowsでは実際に開いたハンドルの参照先を検証します。選択した文書の基準位置をアプリ領域に保持し、再起動後も同じ位置から参照できます。[Rust側の設計](docs/RUST-BACKEND.md)を参照してください。
- Markdown・HTML・PDF・SVGの保存ジョブは共通管理し、終了時に内容生成と書き込みを待ちます。失敗した場合は終了を中止します。
- HTMLはスクリプトと通信を禁止するCSPを持ちます。PDFは同じ静的HTMLを、Tauri権限を持たない非表示の専用WebViewで描画し、画像・フォントの読み込みを待って生成します。
- ロックファイルで依存関係を固定します。`fast-uri`と`serialize-javascript`は修正版へ固定し、`@rollup/plugin-node-resolve`のパッチで`deepmerge`を除去しています。監査の無視設定は使っていません。

```sh
pnpm test
pnpm test:browser
pnpm test:desktop
pnpm test:portable
pnpm audit
cargo test --locked --manifest-path src-tauri/Cargo.toml --target aarch64-pc-windows-msvc --lib
```

ブラウザーテストはインストール済みのEdgeを使います。`test:desktop`はネイティブAPIのモック検証なので、実機の保存・終了も確認します。結果と公開前の残項目は[検証記録](docs/VALIDATION.md)、プライバシーポリシー案は[PRIVACY.md](docs/PRIVACY.md)を参照してください。
