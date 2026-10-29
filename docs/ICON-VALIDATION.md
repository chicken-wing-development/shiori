# アプリアイコン更新の検証

実施日: 2026年10月29日。対象: shiori 1.0.0。

## 反映内容

採用された「しおりの枠と読書する人物」の画像を`assets/branding/shiori-app-icon-v1.png`へ保存し、元の生成画像とSHA-256が一致することを確認した。Windowsの実行ファイル・ウィンドウ・タスクバー、Storeロゴ、Web/PWAと単一HTML版のファビコンに反映。アプリ情報画面の詳細なロゴは別素材として管理する。

`pnpm icons`で各サイズを再生成できる。ICOは16・20・24・32・40・48・64・128・256pxの9サイズ。元画像から直接縮小し、透過を保持する。PWAのmaskable画像は不透明な背景と余白を付ける。

最初のReleaseビルドで、exeに旧アイコンの6サイズが残っていることをリソースのハッシュ比較で検出した。Tauriのビルドヘルパーがアイコンを変更検知の対象にしていなかったため、`src-tauri/build.rs`に`cargo:rerun-if-changed=icons`を追加。修正後に両CPU版を再ビルドした。

## 確認結果

- 採用画像とプロジェクト内の元画像の一致、PNG寸法・透過、ICO全9サイズのデコード、maskable画像の不透明性を確認。
- 明暗背景の実寸プレビューで、各サイズの描画を確認。
- Web・デスクトップのビルド済み画像と単一HTMLの埋め込みfavicon、計13参照が更新済みの素材と一致。
- ARM64・x64両方で、exe内の9個のアイコンリソースすべてが採用画像から生成したICOフレームとSHA-256で一致。
- 両配布版を専用プロファイルで起動し、新しいウィンドウアイコン・編集画面・通常終了を実WebView2で確認。ARM64ではアプリ情報画面の詳細ロゴも確認。x64はWindows 11 ARM64上のエミュレーションで検証。
- ZIP / MSIXのハッシュ、CPU種別、内蔵exeの一致、第三者ライセンス同梱、MSIXの3種類のロゴ一致を確認。
- 型検査・Rust書式検査・Web / 単一HTML / Windows両CPU版ビルドに成功。変更は画像・生成スクリプト・ビルドの変更検知に限り、文書処理の回帰テストは再実行していない。
- 検証用ウィンドウはすべて終了。ユーザーの文書位置情報は検証前後で変更なし。

記録は`test-results/icon-refresh/`に保存。`source-verification.json`、`icon-verification.json`、`web-artifact-verification.json`、`executable-icons.json`、`distribution-verification.json`、`native-arm64.json`、`native-x64.json`とビルドログを参照。実寸プレビューは`size-preview.png`。

## 配布物

生成先: `releases/v1.0.0/windows-icon-refresh/`。

- `shiori-1.0.0-arm64.zip`: 5,513,595 bytes
- `shiori-1.0.0-x64.zip`: 5,618,773 bytes
- 両CPU向けの未署名開発用MSIXも生成。Storeへの提出・公開は行っていない。

以前のアイコンは`.task-backups/icon-refresh-20261029/`に退避済み。
