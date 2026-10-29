import type { ReaderDocument } from './types';

const welcome = `# 言葉と図を、心地よく。

考えをまとめたメモも、チームの設計書も。  
**shiori** は、Markdownを読むための小さな場所です。

> ファイルをひらく。それだけで、読む準備はできています。

## まずは、ひとつ開いてみる

右上の **「ファイルを開く」** からMarkdownファイルを選ぶか、このウィンドウにドラッグ＆ドロップしてください。読み込んだファイルは、このブラウザーの中で処理されます。

- **読みやすく整える** — 見出し、表、コードブロックをすっきりと
- **図でつながる** — Mermaidのフローチャートやシーケンス図もそのまま
- **自分のペースで読む** — 目次、検索、文字サイズ、ダークモード

## 考えの流れを、そのまま図に

Markdownのコードブロックに \`mermaid\` と書くと、テキストが図になります。

\`\`\`mermaid
flowchart LR
  A[ファイルをひらく] --> B[Markdownを読む]
  B --> C{アイデアが浮かぶ}
  C --> D[次の一歩へ]
\`\`\`

フローチャート、シーケンス図、クラス図、ガントチャートなど。左の **「Mermaidのサンプル」** で、いろいろな表現を試せます。

## いつものMarkdownに対応

| 書きたいもの | 使える書式 |
| :--- | :--- |
| 文章を整理する | 見出し・リスト・引用 |
| 大切なことを伝える | **太字**・*斜体*・~~取り消し線~~ |
| 情報を並べる | テーブル・タスクリスト |
| コードや設計を残す | シンタックスハイライト・Mermaid |

\`\`\`typescript
const idea = '小さく始めて、少しずつ育てる。';
console.log(idea);
\`\`\`

## このデバイスが、あなたの本棚

- [x] ファイルをサーバーに送信しない
- [x] 最近開いた文章を、このブラウザーに保存
- [x] 一度読み込めば、オフラインでも使える
- [x] ブラウザーからアプリとしてインストール

外部画像は初期状態では読み込みません。相対パスの画像がある文書は **「フォルダーを開く」** を使ってください。保存した履歴は、左側のごみ箱ボタンからいつでも消去できます。

---

*読むことに、少しの余白を。*
`;

const mermaid = `# Mermaidのサンプル

図の右上にある **↗** で拡大できます。「ソース」に切り替えると、元の記法を確認できます。

## フローチャート

処理の流れや、判断の分岐を表せます。

\`\`\`mermaid
flowchart TD
  A[アイデアをメモする] --> B{図が必要？}
  B -->|はい| C[Mermaidを書く]
  B -->|いいえ| D[文章を整える]
  C --> E[プレビューで確認]
  D --> E
  E --> F[チームに共有する]
\`\`\`

## シーケンス図

システム同士のやりとりを、時間の順に。

\`\`\`mermaid
sequenceDiagram
  actor User as あなた
  participant App as shiori
  participant Local as ブラウザー内の保存領域
  User->>App: Markdownをひらく
  App->>App: 文章と図を描画
  App->>Local: 閲覧履歴を保存
  App-->>User: 読みやすいプレビュー
\`\`\`

## クラス図

データの関係や、アプリケーションの構造に。

\`\`\`mermaid
classDiagram
  class Document {
    +String name
    +String content
    +Date openedAt
  }
  class Renderer {
    +compile(source)
    +renderDiagrams()
  }
  class Storage {
    +save(document)
    +getRecent()
  }
  Document --> Renderer
  Document --> Storage
\`\`\`

## ガントチャート

プロジェクトの見通しを、一枚に。

\`\`\`mermaid
gantt
  title 小さなプロジェクト
  dateFormat YYYY-MM-DD
  section つくる
  アイデア整理 :a1, 2026-10-20, 3d
  最初の実装 :a2, after a1, 5d
  section 届ける
  レビュー :a3, after a2, 2d
  リリース :milestone, after a3, 0d
\`\`\`

## 記法で困ったときは

構文に誤りがある図には、エラーの詳細と元のコードを表示します。ほかの文章や図は、そのまま読み続けられます。

詳しくは [Mermaid公式ドキュメント](https://mermaid.js.org/intro/) をご覧ください。
`;

const syntax = `# Markdownの書き方

プレーンテキストに、ほんの少しの記号を足す。それがMarkdownです。

## 見出しと文章

\`\`\`markdown
# 大きな見出し
## セクションの見出し
### 小さな見出し

空行で段落を分けます。
**太字** と *斜体*、~~取り消し線~~も使えます。
\`\`\`

## リストとタスク

- りんご
- みかん
  - 小さなみかん

1. ファイルをひらく
2. プレビューを読む
3. アイデアを広げる

- [x] 読んだドキュメント
- [ ] これから読むドキュメント

タスクリストは閲覧用です。元ファイルの内容は変更しません。

## リンクと画像

[Markdownの仕様](https://spec.commonmark.org/) のようにリンクを書けます。

\`\`\`markdown
[リンクの名前](https://example.com)
![画像の説明](images/sample.png)
\`\`\`

画像を含むローカル文書は、左の「フォルダーを開く」から文書と画像が入っているフォルダーを選びます。フォルダー内のMarkdownへの相対リンクもたどれます。履歴から開いた際に画像が表示されない場合は、フォルダーを選び直してください。

## 引用とコード

> 考えは、書き留めるところから。
>
> ひとつの文章が、次のアイデアにつながります。

文の中には \`console.log('hello')\` のようなインラインコードを。

\`\`\`python
def hello(name):
    return f"こんにちは、{name}さん"
\`\`\`

## テーブル

| 左揃え | 中央揃え | 右揃え |
| :--- | :---: | ---: |
| Markdown | 対応 | 100 |
| Mermaid | 対応 | 200 |

## キーボードで、すばやく

| 操作 | ショートカット |
| :--- | :--- |
| ファイルを開く | Ctrl / ⌘ + O |
| 文書内を検索 | Ctrl / ⌘ + F |
| サイドバーの切り替え | Ctrl / ⌘ + \\ |
| 検索・ダイアログを閉じる | Esc |

## 安心して読むために

HTMLタグは文字として表示します。スクリプトや埋め込みHTMLは実行しません。外部画像は、上部の「外部画像」から文書ごとに読み込みを許可できます。
`;

export const samples: ReaderDocument[] = [
  { id: 'sample-welcome', name: 'はじめに.md', content: import.meta.env?.MODE === 'portable' ? welcome
    .replace('一度読み込めば、オフラインでも使える', 'HTML一つで、オフラインでも使える')
    .replace('ブラウザーからアプリとしてインストール', 'インストール不要でブラウザーから起動') : welcome, openedAt: 0, origin: 'sample' },
  { id: 'sample-mermaid', name: 'Mermaidのサンプル.md', content: mermaid, openedAt: 0, origin: 'sample' },
  { id: 'sample-syntax', name: 'Markdownの書き方.md', content: syntax, openedAt: 0, origin: 'sample' },
];
