import { Editor, Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { createEditorExtensions, type EditorImages } from './editor-schema';
import { sanitizeMarkdown } from './sanitize';
import { validateDocumentContent } from './document-input';

export class RichEditor {
  private editor: Editor;
  private imageRefreshers = new Set<() => void>();
  private toolbar: HTMLElement;
  private toolbarSelection: ReturnType<Editor['state']['selection']['getBookmark']> | undefined;
  private captureToolbarSelection = () => { this.toolbarSelection = this.editor.state.selection.getBookmark(); };
  constructor(host: HTMLElement, toolbar: HTMLElement, content: string, images: EditorImages, onChange: (markdown: string) => void, onInvalid: () => void = () => {}) {
    this.toolbar = toolbar;
    this.editor = new Editor({
      element: host, extensions: [...createEditorExtensions({ ...images, registerRefresh: refresh => { this.imageRefreshers.add(refresh); return () => { this.imageRefreshers.delete(refresh); }; } }), Extension.create({
        name: 'documentSizeLimit',
        addProseMirrorPlugins() {
          const editor = this.editor;
          return [new Plugin({ filterTransaction(transaction) {
            if (!transaction.docChanged) return true;
            try { validateDocumentContent(editor.markdown!.serialize(transaction.doc.toJSON())); return true; }
            catch { onInvalid(); return false; }
          } })];
        },
      })],
      content, contentType: 'markdown', injectCSS: false,
      editorProps: {
        attributes: { class: 'markdown rich-content', role: 'textbox', 'aria-label': 'WYSIWYG編集', 'aria-multiline': 'true', spellcheck: 'false' },
        transformPastedHTML: html => sanitizeMarkdown(html),
      },
      onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
      onTransaction: ({ transaction, appendedTransactions }) => {
        if (this.toolbarSelection) {
          for (const update of [transaction, ...appendedTransactions]) this.toolbarSelection = this.toolbarSelection.map(update.mapping);
        }
        this.syncToolbar(toolbar);
      },
    });
    toolbar.addEventListener('pointerdown', this.captureToolbarSelection);
    toolbar.addEventListener('focusin', this.captureToolbarSelection);
    this.syncToolbar(toolbar);
  }
  destroy(): void {
    this.toolbar.removeEventListener('pointerdown', this.captureToolbarSelection);
    this.toolbar.removeEventListener('focusin', this.captureToolbarSelection);
    this.editor.destroy();
  }
  focus(): void { this.editor.commands.focus(); }
  refreshImages(): void {
    for (const refresh of this.imageRefreshers) refresh();
  }
  private syncToolbar(toolbar: HTMLElement): void {
    if (!this.editor) return;
    const editor = this.editor;
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-rich-action]')) {
      const action = button.dataset.richAction!;
      const active = ['bold', 'italic', 'strike', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'code', 'codeBlock'].includes(action) && editor.isActive(action);
      if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(active));
      if (action === 'undo') button.disabled = !editor.can().undo();
      if (action === 'redo') button.disabled = !editor.can().redo();
      if (['addRowAfter', 'addColumnAfter', 'deleteRow', 'deleteColumn', 'deleteTable'].includes(action)) button.disabled = !editor.isActive('table');
    }
    const style = toolbar.querySelector<HTMLSelectElement>('#block-style')!;
    // A queued editor transaction must not reset the option the user is
    // choosing in the native menu before its change event is committed.
    if (style !== toolbar.ownerDocument.activeElement) {
      const value = editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph';
      if (style.value !== value) style.value = value;
    }
  }
  private selectionChain() {
    const chain = this.editor.chain();
    if (this.toolbarSelection) {
      try {
        const selection = this.toolbarSelection.resolve(this.editor.state.doc);
        chain.command(({ tr }) => { tr.setSelection(selection); return true; });
      } catch { this.toolbarSelection = undefined; }
    }
    return chain.focus(undefined, { scrollIntoView: false });
  }
  setBlock(value: string): boolean {
    const chain = this.selectionChain();
    if (value === 'paragraph') return chain.setParagraph().run();
    if (!/^[1-6]$/.test(value)) return false;
    return chain.setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  }
  action(action: string): boolean {
    const chain = this.selectionChain();
    switch (action) {
      case 'bold': return chain.toggleBold().run();
      case 'italic': return chain.toggleItalic().run();
      case 'strike': return chain.toggleStrike().run();
      case 'bulletList': return chain.toggleBulletList().run();
      case 'orderedList': return chain.toggleOrderedList().run();
      case 'taskList': return chain.toggleTaskList().run();
      case 'blockquote': return chain.toggleBlockquote().run();
      case 'code': return chain.toggleCode().run();
      case 'codeBlock': return chain.toggleCodeBlock().run();
      case 'mermaid': return chain.insertContent([{ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'flowchart LR\n  A[開始] --> B[完了]' }] }, { type: 'paragraph' }]).run();
      case 'table': return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      case 'addRowAfter': return chain.addRowAfter().run();
      case 'addColumnAfter': return chain.addColumnAfter().run();
      case 'deleteRow': return chain.deleteRow().run();
      case 'deleteColumn': return chain.deleteColumn().run();
      case 'deleteTable': return chain.deleteTable().run();
      case 'undo': return chain.undo().run();
      case 'redo': return chain.redo().run();
      default: return false;
    }
  }
  insert(type: 'link' | 'image', source: string, label: string): boolean {
    if (/^[\s\S]*[\u0000-\u001f\\]/.test(source) || (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^(https?:|mailto:|tel:)/i.test(source))) return false;
    if (type === 'image') return this.selectionChain().setImage({ src: source, alt: label }).run();
    return this.selectionChain().insertContent({ type: 'text', text: label || source, marks: [{ type: 'link', attrs: { href: source } }] }).run();
  }
  getSelectedText(): string { const { from, to } = this.editor.state.selection; return this.editor.state.doc.textBetween(from, to, ' '); }
  find(term: string): { from: number; to: number }[] {
    const matches: { from: number; to: number }[] = [];
    this.editor.state.doc.descendants((node, position) => {
      if (!node.isTextblock || matches.length >= 500) return;
      const text = node.textBetween(0, node.content.size, '', '\ufffc').toLowerCase();
      for (let index = text.indexOf(term); index !== -1 && matches.length < 500; index = text.indexOf(term, index + term.length)) matches.push({ from: position + index + 1, to: position + index + term.length + 1 });
      return false;
    });
    return matches;
  }
  selectRange(range: { from: number; to: number }, focus = true): void { const chain = this.editor.chain(); if (focus) chain.focus(); chain.setTextSelection(range).scrollIntoView().run(); }
}
