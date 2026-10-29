# shiori 1.0.0 — エクスポート安全性の修正・検証

この後に追加したヘルプ・プライバシー・コピーライト画面と見出し幅調整の記録は[画面変更の検証](APP-INFO-VALIDATION.md)、アプリアイコンの更新は[アイコン変更の検証](ICON-VALIDATION.md)を参照。正式名と製品IDを設定した最新の提出用パッケージは`releases/v1.0.0/store/upload/`。Store準備時の再検証は[Store提出準備](STORE-SUBMISSION.md)に記録しています。

実施日: 2026-10-29。Windows 11 ARM64、Node.js 24.22.1、Rust 1.98.1、MSVC、Windows SDK 10.0.26100、Edge / WebView2 156。

## 修正内容

1. **外部画像の取得先検証**: Windows版ではRustがURLとDNS結果を検証し、公開IPへ接続先を固定して取得します。localhost・内部IP・特殊用途アドレス、認証情報付きURL、リダイレクト、プロキシを拒否します。Cookie・認証情報・リファラーを送信せず、同時2件、15秒、1枚8 MiBに制限します。
2. **リンクの正規化**: `//example.com/path`形式のリンクを、HTML・PDF出力時に`https://example.com/path`へ変換します。ファイルとして開いてもUNC / file URLになりません。通常の相対ファイルリンクと見出しリンクは維持します。
3. **画像の実データ検証**: ファイル・data URL・外部URLの全経路で、ラスター画像の実データ形式と宣言された形式を照合し、実際にデコードできることを確認します。SVGは安全化した結果をデコードします。不正・破損・形式不一致・32メガピクセル超過の場合は、保存処理へ進みません。

Web / PWA / 単一HTML版はDNS結果と実際の接続先を固定できないため、エクスポート時の外部URL画像の自動取得を行いません。ローカルに保存して相対パスで参照するか、Windows版で出力する案内を表示します。通常のMarkdown保存は本文を維持し、画像変換を行いません。

設計: [Rust側の構成](RUST-BACKEND.md)。変更前のファイルは`.task-backups/export-security-20261029/`へ退避しています。

## 回帰テスト

| 検証 | 結果 |
| --- | --- |
| Node: Markdown、入力サイズ、相対パス、下書き | 30件成功 |
| ブラウザー: HTML、PDF、画像検証、リンク、画面と保存 | 22件成功 |
| Tauri IPCモック: 外部画像のRust経由取得、破損時の保存停止、終了待機など | 18件成功 |
| 単一HTMLアプリ: 製品CSP下のオフラインHTML / PDF出力 | 2件成功 |
| Rust: IP・URL・DNS、HTTP応答、保存先認可、原子的保存、PDF隔離 | 21件成功 |
| TypeScript型検査・Rust書式検査 | 成功 |
| Web/PWA・単一HTML・デスクトップ画面のビルド | 成功 |

合計93件。追加・更新したテストは、内部IPの数値・16進・短縮表記、IPv6・IPv4-mapped・移行アドレス、内部IPを含むDNS応答、DNS固定、リダイレクト拒否、Content-Type、Content-Lengthとストリーム双方の容量制限、不正PNG・途中で切れたPNG・拡張子不一致・data URL、参照形式リンクを確認します。容量テストはゼロ埋めの偽PNGを廃止し、実際にデコードできるPNGを使用します。

## 実WebView2

`tests/native/tauri.security.json`の専用アプリIDとWebView2プロファイルで、製品のRustコマンドとフロントエンドの変換・保存コードを使いました。IPC・ファイル選択ダイアログ・PDF生成はモックを使用していません。

9件すべて成功しました。

- 内部URLとエクスポート経由のループバックアクセスを拒否。専用ローカル受信サーバーへのリクエストは0件。
- 実WebView2で破損したローカル画像・data画像・途中で切れたPNGを拒否。
- 公開HTTPS画像をRustで取得し、HTMLへ埋め込み。
- `//`リンクがHTTPSになり、PNGとMermaid由来SVGをデコード。
- ネイティブ保存ダイアログで保存先を指定後、不正画像のHTML・PDF出力を拒否。出力ファイルが作成されないことを確認。
- 正常なHTML・PDFをネイティブ保存。

`test-results/export-security-fix/native/valid-html.html`は59,400 bytes。ファイルURL・オフライン状態でPNGとMermaid由来SVGの2画像が表示され、スクリプト0個・外部リクエスト0件、リンク先はHTTPSでした。

`valid-pdf.pdf`は81,118 bytes、A4・1ページ。日本語、参照画像、Mermaidとその文字を確認し、PDF内リンクもHTTPSでした。Popplerでページを画像化し、欠落・重なりがないことを目視確認しました。

記録: 同フォルダーの`webview2-results.json`、`network.json`、`output-verification.json`、`pdf-verification.json`、`pdf-page.png`。テストアプリとサーバーは終了しています。

## 配布ビルド

ARM64・x64のReleaseビルドと、両CPU向けZIP・開発用MSIXの作成に成功しました。出力先は`releases/v1.0.0/windows-export-security/`です。

4配布物のSHA-256、内蔵exeとビルド済みexeの一致、PEのCPU種別、ライセンス同梱を確認しました。検証専用のアプリID・ページが製品へ含まれないことも確認しています。

両配布版を専用プロファイルで起動し、編集画面・Desktop版表示・通常終了を確認しました。x64はARM64上のエミュレーションによる確認です。ユーザーの元の文書位置情報はSHA-256が一致し、変更されていません。

記録: `test-results/export-security-fix/distribution-verification.json`、`native/smoke-results.json`、`build-*.log`、`package-*.log`。

## 依存関係

HTTP/TLS取得にreqwest 0.13.5とWindowsのSChannelを使用します。Windows対象のRustSec監査は既知脆弱性0件でした。ロックファイル全体の`proc-macro-error`、`zbus_names`、`zvariant`、`zvariant_derive`、`glib`に関する警告はWindowsの依存グラフに含まれません。無視設定は使用していません。記録は`test-results/export-security-fix/cargo-audit.json`と`windows-audit-verification.json`です。

## 再現手順

通常のテストは`pnpm test`、`pnpm test:browser`、`pnpm test:desktop`、`pnpm test:portable`、`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`で実行できます。単一HTMLテストの前に`pnpm build:portable`と`node scripts/prepare-portable-tests.mjs`を実行します。

実WebView2の検証は、`node tests/native/serve-security.mjs`を起動し、別の端末で専用の`WEBVIEW2_USER_DATA_FOLDER`を指定したうえで`node node_modules/@tauri-apps/cli/tauri.js dev --no-watch --config tests/native/tauri.security.json -- --locked`を実行します。4つの保存ボタンを順に選び、`test-results/export-security-fix/native/`配下へ表示されたファイル名で保存します。公開画像の正常系テストにはインターネット接続が必要です。

結果は`node tests/native/verify-security.mjs`と`python tests/native/verify-security-pdf.py`で検証します。配布物の確認は`python tests/native/verify-packages.py`です。検証ページは開発用サーバーだけで使用し、製品ビルドには含めません。

## 公開前の残項目

MSIXは未署名の開発用パッケージです。正式なPartner CenterのPackage Identity、掲載情報、プライバシーポリシー公開URL、署名・インストール・更新・アンインストール、Windows App Certification Kit、Intel / AMD実機、Store審査・公開は別途必要です。[Windows配布手順](WINDOWS-RELEASE.md)を参照してください。
