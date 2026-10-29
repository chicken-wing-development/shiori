import { icon } from './icons';

function richButton(action: string, label: string, text: string, toggle = false): string {
  return `<button type="button" data-rich-action="${action}" title="${label}" aria-label="${label}" ${toggle ? 'aria-pressed="false"' : ''}>${text}</button>`;
}

export const richEditorMarkup = `
    <section id="rich-view" class="rich-view" aria-label="WYSIWYG編集画面" hidden>
      <div id="rich-toolbar" class="rich-toolbar" role="toolbar" aria-label="書式設定">
        <select id="block-style" aria-label="段落の書式"><option value="paragraph">標準テキスト</option>${[1,2,3,4,5,6].map(level => `<option value="${level}">見出し ${level}</option>`).join('')}</select>
        <span class="tool-separator"></span>
        ${richButton('bold', '太字 (Ctrl+B)', '<b>B</b>', true)}${richButton('italic', '斜体 (Ctrl+I)', '<i>I</i>', true)}${richButton('strike', '取り消し線', '<s>S</s>', true)}${richButton('code', 'インラインコード', '&lt;/&gt;', true)}
        <span class="tool-separator"></span>
        ${richButton('bulletList', '箇条書き', '• ≡', true)}${richButton('orderedList', '番号付きリスト', '1. ≡', true)}${richButton('taskList', 'タスクリスト', '☑', true)}${richButton('blockquote', '引用', '❝', true)}
        <span class="tool-separator"></span>
        ${richButton('link', 'リンクを挿入', 'リンク')}${richButton('image', '画像を挿入', icon('image'))}${richButton('codeBlock', 'コードブロック', icon('code'), true)}${richButton('mermaid', 'Mermaid記法を挿入', icon('diagram'))}
        <details class="table-menu"><summary title="表の操作" aria-label="表の操作">表 ▾</summary><div>${richButton('table', '表を挿入', '表を挿入')}${richButton('addRowAfter', '下に行を追加', '下に行を追加')}${richButton('addColumnAfter', '右に列を追加', '右に列を追加')}${richButton('deleteRow', '行を削除', '行を削除')}${richButton('deleteColumn', '列を削除', '列を削除')}${richButton('deleteTable', '表を削除', '表を削除')}</div></details>
        <span class="tool-separator"></span>${richButton('undo', '元に戻す (Ctrl+Z)', '↶')}${richButton('redo', 'やり直す (Ctrl+Shift+Z)', '↷')}
      </div>
      <div id="editor-feedback" class="editor-feedback" role="alert" hidden><span id="editor-feedback-message"></span><button class="icon-button" id="dismiss-editor-feedback" aria-label="編集メッセージを閉じる">${icon('close')}</button></div>
      <div class="rich-scroll"><div id="rich-editor" class="rich-editor"></div></div>
      <div class="editor-hint">Mermaidはコード欄で記法を編集します。図の確認は「閲覧」または「Markdown」へ。</div>
    </section>

  <dialog id="insert-dialog" class="insert-dialog" aria-labelledby="insert-title"><div class="dialog-heading"><span id="insert-title">リンクを挿入</span><button class="icon-button" data-close-dialog aria-label="閉じる">${icon('close')}</button></div><form id="insert-form" class="dialog-body"><label for="insert-source" id="insert-source-label">URLまたは相対パス</label><input class="text-input" id="insert-source" required /><label for="insert-label" id="insert-label-label">表示テキスト</label><input class="text-input" id="insert-label" /><div class="dialog-footer"><button type="button" class="text-button" data-close-dialog>キャンセル</button><button class="primary-button" type="submit">挿入</button></div></form></dialog>
`;
