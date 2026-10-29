import '../src/main';

// Exercise the application's real file-input handler with disposable fixture files.
const rootFile = new File(['# テキスト\n\nワークエリア直下のMarkdownです。'], 'テキスト.md', { type: 'text/markdown' });
const projectFile = new File(['# プロジェクトA\n\nフォルダー構成をそのまま使えます。\n\n![プロジェクトの画像](./img/1.png)\n\n## 次のアイデア\n\nツリーから文書と画像を選択できます。'], '1.md', { type: 'text/markdown' });
Object.defineProperty(projectFile, 'webkitRelativePath', { value: 'プロジェクトA/1.md' });
const imageResponse = await fetch('/icons/icon-192.png');
const image = new File([await imageResponse.blob()], '1.png', { type: 'image/png' });
Object.defineProperty(image, 'webkitRelativePath', { value: 'プロジェクトA/img/1.png' });
const transfer = new DataTransfer();
[rootFile, projectFile, image].forEach(file => transfer.items.add(file));
const input = document.querySelector<HTMLInputElement>('#file-input')!;
input.files = transfer.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
