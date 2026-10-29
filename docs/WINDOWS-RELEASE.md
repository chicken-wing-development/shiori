# shiori markdown editor 1.0.0 — Windows / Microsoft Store配布

予約済みの正式IDによる提出物・掲載素材・最新の検証状況は[Store提出準備](STORE-SUBMISSION.md)を参照してください。提出用バンドルは`releases/v1.0.0/store/upload/`にあります。

この手順はRust + Tauri 2デスクトップ版を対象とします。Web / PWA版は従来の`pnpm build`、アプリ全体の単一HTML版は`pnpm build:portable`で生成します。文書はMarkdownをそのまま保存でき、画像とMermaidのSVGを含む単一HTML・PDFへエクスポートできます。

## 開発環境

- Windows 11、WebView2 Evergreen Runtime
- Node.js 22.12以上、pnpm 11.25.0
- Rust 1.98以上（検証環境: 1.98.1 / MSVC）
- Visual Studio 2022 Build Toolsの「C++によるデスクトップ開発」とWindows SDK
- ARM64向けには`Microsoft.VisualStudio.Component.VC.Tools.ARM64`も必要

Microsoftの公式インストーラーを使います。ARM64 PCでも、Intel / AMD向けのx64とARM64をそれぞれビルドできます。Rustのターゲットだけでなく、対応するC++ツールとSDKのライブラリーが必要です。

```powershell
pnpm install --frozen-lockfile
rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc
pnpm test
pnpm test:browser
pnpm test:desktop
pnpm desktop:build --target x86_64-pc-windows-msvc -- --locked
pnpm desktop:build --target aarch64-pc-windows-msvc -- --locked
```

`src-tauri/target/<target>/release/shiori-markdown.exe`に生成されます。ブラウザーテストはインストール済みのEdgeを使用します。GitHubへソースを登録する場合は`.github/workflows/windows.yml`で両アーキテクチャの実行ファイルを生成できます。CIからStoreへの提出はしません。

## Store用の識別情報

Partner Centerでアプリ名を予約し、製品IDのページから以下の値を取得します。Tauriの`identifier`とStoreのPackage Identityは別物です。

| JSONフィールド | 設定する値 |
| --- | --- |
| `identityName` | Package/Identity/Name |
| `publisher` | Package/Identity/Publisher（CN=から始まる文字列） |
| `publisherDisplayName` | Package/Properties/PublisherDisplayName |
| `displayName` | 予約したアプリの表示名 |

```powershell
Copy-Item store/store-identity.example.json store/store-identity.json
# store/store-identity.json をPartner Centerの実値で編集
pnpm store:pack -Architecture x64
pnpm store:pack -Architecture arm64
```

スクリプトはReleaseビルド、PEのCPUアーキテクチャ・バージョンの照合、アイコンとライセンスの同梱、MakeAppxの検証とパッケージ作成、SHA-256出力を行います。既に同じソースでビルド済みの場合は`-SkipBuild`を付けられます。`-PrepareOnly`ではパッケージ内容の準備までで止めます。

生成先は`releases/v1.0.0/windows/<PackageIdentity>_1.0.0.0_<arch>.msix`です。Store用の第4バージョン要素は0に固定しています。次回更新は`package.json`と`src-tauri/Cargo.toml`を同じバージョンへ上げてください。

別の場所へ作成する場合は、`-OutputDirectory releases/v1.0.0/windows-pdf-html`のようにプロジェクトからの相対パスを指定できます。

同じ場所の`shiori-1.0.0-<arch>/shiori-markdown.exe`は直接起動できる開発版です。フォルダーとZIPに第三者ライセンスとMPL依存の未改変ソースを同梱します。MSIXにはPartner Centerの実値を設定する必要があります。

実際のStore IDが未取得でも、次のコマンドで**開発確認専用**の未署名MSIXを生成できます。この開発用IDをそのままStoreへ提出しないでください。

```powershell
pnpm store:pack -Architecture arm64 -IdentityPath store/development-identity.json
```

Store提出用のMSIXには、ローカルの自己署名は不要です。Microsoft Storeで配布される際に署名されます。ローカルでMSIXをインストールして検証する場合は、Publisherと一致する開発証明書で署名し、その証明書をテストPCで信頼する必要があります。このプロジェクトのスクリプトは証明書の作成・信頼ストア変更を自動実行しません。

## WebView2と保存領域

MSIXはWindows 11以降を対象とし、WindowsのWebView2 Evergreen Runtimeを使用します。WebView2を削除した環境では起動できないため、審査用の要件とサポート情報に記載してください。MSIXには別のRuntimeインストーラーを同梱していません。通常配布用NSISを`pnpm tauri build --bundles nsis`で生成する場合は、TauriのWebView2 bootstrapper設定を使用します。

デスクトップ版の本文・下書き・取り込んだ画像はWebViewのIndexedDBに保持します。Store版と未パッケージ版、Web / PWA版は保存領域が異なる場合があります。Markdownファイルと画像を保存し、新しい版で取り込んで移行してください。Storeの更新にはTauriの独自Updaterを使いません。

## 提出前の確認

- x64 / ARM64実機で、起動、ネイティブダイアログからのMarkdown取り込みと相対画像の自動読み込み、共通の親フォルダーの手動指定、ドラッグ＆ドロップ、日本語IME、終了直前の下書き保存、再起動後の新しい画像参照を確認
- Markdown / HTML / PDF / SVGの保存、保存キャンセル、保存権限不足、既存ファイルへの上書き確認を実機で確認
- 単一HTMLをオフラインで開き直し、画像・SVG・見出し移動・表を確認。PDFは日本語、画像、図、表、ページ分割、文字の選択を確認
- 自己署名したMSIXをテストPCへインストールし、アップグレード・アンインストールとWindows App Certification Kitを確認
- Storeのアプリ名、説明、スクリーンショット、カテゴリ、対象年齢、プライバシー通知を用意
- `runFullTrust`の使用理由として、ローカルMarkdownの閲覧・編集とユーザー選択先への保存を説明
- 公開日・価格・地域・Store表示名、同梱素材と依存ライセンスを確認してからPartner Centerへ提出

プライバシー通知本文は[PRIVACY.md](PRIVACY.md)です。発行元は「テバ開発」、問い合わせ先は掲載しない方針です。アプリ内にも表示しています。Microsoftの現行手順では通知のURLまたは本文を登録できます。本文は`releases/v1.0.0/store/listing/privacy.txt`、公開用HTMLは同フォルダーの`website/privacy.html`です。HTMLは未公開です。実際の提出画面がURLのみ受け付ける場合は、先に管理しているWebサイトへ公開してURLを設定します。[公式のプライバシー・サポート情報](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info)

## 公式資料

- [Tauriの必要環境](https://v2.tauri.app/start/prerequisites/)
- [MicrosoftによるTauriのMSIX配布ガイド](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri)
- [MSIXマニフェストの作成](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion)
- [MakeAppxによるパッケージ作成](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool)
