# shiori markdown editor 1.0.0 — Store提出準備

準備日: 2026年10月29日。提出ファイルと掲載素材を作成済み。Partner Centerへのアップロード、審査提出、公開は行っていません。

## 提出するファイル

`releases/v1.0.0/store/upload/5D6DC947.shiorimarkdowneditor_1.0.0.0_x64_arm64.msixbundle`

- x64とARM64の2パッケージを含む、11,698,691 bytesのバンドル
- SHA-256: `c55e7ac785a175fc40b62201f78acbb4b64bafed2ff54983154cb2ee795bea1c`
- 未署名のStore提出用。Microsoft Storeの配布時に署名されます。ローカルのダブルクリックによるインストール用署名はありません。[公式のパッケージ要件](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- `packages/`には各アーキテクチャのMSIXも保存しています。通常はバンドル1個を提出し、同じMSIXを重複してアップロードしません。
- `.sha256`や`listing/`は提出パッケージではありません。

## 確定した登録情報

| 項目 | 値 |
| --- | --- |
| 表示名・予約名 | shiori markdown editor |
| Package/Identity/Name | 5D6DC947.shiorimarkdowneditor |
| Package/Identity/Publisher | CN=D0411010-4A66-49C6-8501-3C08B3C6E4C7 |
| Package/Properties/PublisherDisplayName | テバ開発 |
| バージョン | アプリ1.0.0 / MSIX 1.0.0.0 |
| 価格 | 無料（ユーザー確認済み） |
| 画面・掲載言語 | 日本語 / ja-JP |
| 対応OS | Windows 11 build 22000以降 |
| CPU | x64、ARM64 |
| 実行環境 | Microsoft Edge WebView2 Evergreen Runtime |
| カテゴリ案 | Productivity / 仕事効率化 |
| 問い合わせ先 | 掲載しない（ユーザー指定） |
| 配信地域 | 未確定。日本のみ / 全地域の確認待ち |

名前はTauri製品名、ウィンドウタイトル、アプリ情報、Web/PWAの正式名、パッケージ表示名へ反映しています。既存データを引き継ぐためTauri identifierと保存領域名は継続します。ヘッダーのブランド表記は短い「shiori」です。

## 掲載素材

すべて`releases/v1.0.0/store/listing/`にあります。編集元は`store/listing.ja-JP.json`です。

| Storeの入力欄 | ファイル |
| --- | --- |
| 説明 | description.txt |
| 短い説明 | short-description.txt |
| 主な機能（1行ずつ） | features.txt |
| 検索語候補（該当欄がある場合） | keywords.txt |
| コピーライト | copyright.txt |
| プライバシー通知本文 | privacy.txt |
| Storeアイコン | app-icon-300.png（300×300） |
| 掲載画像 | screenshots/01-markdown.png ～ 04-dark.png |
| 画像の説明 | screenshot-captions.txt |
| 審査担当者向け説明 / runFullTrustの理由 | reviewer-notes.txt |
| 動作確認用文書 | sample/reading-notes.md |
| 公開用プライバシーHTML | website/privacy.html（未公開） |

画像はPNG、1600×1000、4枚とも50 MB未満です。説明の文字数・機能数・キャプション長も確認しています。初回提出の「このバージョンの最新情報」は空欄とします。[画像要件](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images)、[掲載欄の仕様](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info)

画像は製品版の`dist-desktop`を、専用プロファイルのEdgeで描画して直接撮影しています。ファイルを開く処理とイベント登録のみテスト用の橋渡しを使用しています。文書・Mermaid・編集画面は実際のフロントエンドによる描画で、加工や宣伝文の合成はありません。撮影条件は`screenshots/provenance.json`を参照してください。インストール済みMSIXや実WebView2での今回の検証を意味するものではありません。

プライバシー通知は本文登録を想定しています。Microsoftの現行手順にはURLまたは本文の登録が記載されています。実際のPartner CenterがURLを要求する場合は`website/privacy.html`を管理するサイトへ公開してからURLを入力してください。ローカルファイルのパスは登録しません。PC向けアプリのサポート情報は任意で、今回はユーザーの指定により空欄です。[公式のプライバシー・サポート情報](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info)

## 今回の検証

| 検証 | 結果 |
| --- | --- |
| TypeScript / デスクトップフロントエンド | 両ビルドで成功 |
| Windows ARM64 / x64 Release | 両方成功 |
| Node回帰テスト | 30件成功 |
| EdgeでのWeb回帰テスト | 31件成功 |
| Tauri IPCモック回帰テスト | 18件成功 |
| 単一HTML回帰テスト | 2件成功 |
| MakeAppx pack / bundle | 両MSIX・バンドル作成成功 |
| バンドル・両MSIXの検証 | 製品ID、Publisher、正式名、バージョン、CPU、埋め込みEXE、画像、通知、ライセンス、MPL対象ソースを照合 |
| パッケージハッシュ | SHA-256、各ファイルの64 KiBブロック、FileHashを照合 |
| ネイティブ依存DLL | VC++ランタイムDLLへの追加依存なし。WindowsのDLLを使用 |
| pnpm audit | 既知脆弱性0件 |
| RustSec | 脆弱性0件。5件の保守終了・unsound警告はいずれもx64 / ARM64の依存グラフに含まれないことを確認 |

ログとJSONレポートは`test-results/store-preparation/`です。SDK追加前のビルドに使ったWindows SDKは10.0.26100、RustSec DB最終更新は2026-10-28です。過去に実施した実WebView2のエクスポート検証は[VALIDATION.md](VALIDATION.md)、アイコンの実機確認は[ICON-VALIDATION.md](ICON-VALIDATION.md)を参照してください。今回の正式名変更後に実機UIを再確認したという扱いにはしていません。

## 提出前に残っている確認

1. 配信地域と公開タイミングを確定し、Partner Centerで無料を設定する。
2. IARCの年齢評価質問票へ、実際の設問に沿って回答する。アプリは文書エディタで、ゲーム、広告、課金、内蔵チャット、ユーザー間のコンテンツ配信機能はない。年齢区分を推測して固定していません。
3. `runFullTrust`の説明を審査メモに登録する。本文はローカル文書・参照画像の読み取り、保存ダイアログ、PDF生成のために必要なデスクトップ処理を説明しています。
4. テスト環境でMSIXのインストール、起動、保存、更新、アンインストール、実WebView2画面を確認する。自己署名を利用する場合は提出バンドルのコピーに行い、テスト用証明書と信頼設定を管理してください。今回は証明書の作成・信頼ストア変更・MSIXインストールを行っていません。
5. Windows App Certification Kit（WACK）を実行し、HTML/XMLレポートを確認する。
6. 提出パッケージと掲載素材をPartner Centerへ登録し、プライバシー欄の形式、認定情報、各項目のエラーを確認してから審査へ提出する。

WACKは**未実施**です。署名を確認したMicrosoft公式SDKセットアップ10.1.26100.9457でWindows Software Logo Toolkitの追加を実施し、ユーザーが管理者確認を承認、終了コード0で完了しました。しかし、このARM64 PCではセットアップがWACK本体のx86/x64パッケージを選択せず、SupportedAPIsのXMLだけを導入しました。`appcert.exe`は存在しません。`wack-install.log`の`OS Architecture: arm64`、WACK本体`execute: None`、SupportedApiList`execute: Install`が根拠です。対応するテストPCで実行する必要があります。

WACKの準備が整ったPCで、管理者ターミナルから次を実行できます。インストールに必要な署名・開発環境はそのPCで準備してください。このスクリプトは信頼ストアや開発者モードを変更しません。[WACK公式手順](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit)

```powershell
powershell -NoProfile -File scripts/test-store-certification.ps1 -PackagePath releases/v1.0.0/store/upload/5D6DC947.shiorimarkdowneditor_1.0.0.0_x64_arm64.msixbundle
```

## 再生成

プロジェクトルートで実行します。`-SkipBuild`は同じソース・正式名でビルド済みの場合だけ使用します。

```powershell
pnpm desktop:build --target aarch64-pc-windows-msvc -- --locked
pnpm desktop:build --target x86_64-pc-windows-msvc -- --locked
pnpm store:pack -Architecture arm64 -SkipBuild -MsixOnly -OutputDirectory releases/v1.0.0/store/packages
pnpm store:pack -Architecture x64 -SkipBuild -MsixOnly -OutputDirectory releases/v1.0.0/store/packages
pnpm store:bundle
python tests/native/verify-store.py
pnpm store:assets
pnpm store:screenshots
```

`store:bundle`は開発用ID、表示名不一致、各MSIXの製品ID・Publisher・バージョン不一致、ハッシュ不一致を拒否します。パッケージ生成時にもEXEの製品名・バージョン・CPUを照合します。自動アップロード・公開は行いません。
