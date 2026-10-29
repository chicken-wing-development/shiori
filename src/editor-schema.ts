import { Node, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import Image from '@tiptap/extension-image';
import Paragraph from '@tiptap/extension-paragraph';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import { Marked } from 'marked';

export interface EditorImages { resolve(source: string): string | undefined; registerRefresh?(refresh: () => void): () => void; }

// The upstream paragraph parser unwraps a standalone image as a block. Our
// images are inline, so retain its paragraph to keep the editor schema valid.
const ImageParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    if (token.tokens?.length === 1 && token.tokens[0].type === 'image') {
      return helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens));
    }
    return this.parent!(token, helpers);
  },
});

/** HTML stays literal, just as it does in the reader. Keep it through rich edits. */
const RawInline = Node.create({
  name: 'rawInline', inline: true, group: 'inline', atom: true,
  addAttributes: () => ({ source: { default: '' } }),
  renderHTML: ({ node }) => ['span', { class: 'raw-inline' }, node.attrs.source],
  markdownTokenName: 'rawInline',
  markdownTokenizer: {
    name: 'rawInline', level: 'inline', start: '<',
    tokenize(source) {
      const match = /^(?:<!--[\s\S]*?-->|<\/?[a-zA-Z][\w:-]*(?:\s[^<>]*?)?\/?>)/.exec(source);
      return match ? { type: 'rawInline', raw: match[0], text: match[0] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('rawInline', { source: token.raw }),
  renderMarkdown: node => node.attrs?.source ?? '',
});

const RawBlock = Node.create({
  name: 'rawBlock', group: 'block', content: 'text*', code: true, marks: '', defining: true,
  renderHTML: () => ['pre', { class: 'raw-block', 'data-raw-markdown': '' }, ['code', {}, 0]],
  markdownTokenName: 'html',
  parseMarkdown: (token, helpers) => helpers.createNode('rawBlock', {}, token.raw ? [helpers.createTextNode(token.raw)] : []),
  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? []),
});

// A fence must remain valid even when the code itself contains three backticks.
const EditableCode = CodeBlock.extend({
  renderMarkdown(node, helpers) {
    const code = helpers.renderChildren(node.content ?? []);
    const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map(run => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}${node.attrs?.language ?? ''}\n${code}\n${fence}`;
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'rich-code-block';
      const bar = document.createElement('div');
      bar.className = 'rich-code-bar'; bar.contentEditable = 'false';
      const label = document.createElement('span');
      const language = document.createElement('input');
      language.setAttribute('aria-label', 'コードの言語'); language.placeholder = 'text'; language.spellcheck = false;
      const pre = document.createElement('pre');
      const contentDOM = document.createElement('code');
      pre.append(contentDOM); bar.append(label, language); dom.append(bar, pre);
      const sync = () => {
        language.value = node.attrs.language ?? '';
        dom.dataset.language = language.value.toLowerCase();
        label.textContent = language.value.toLowerCase() === 'mermaid' ? 'MERMAID · 記法を編集' : 'CODE';
      };
      sync();
      language.addEventListener('change', () => {
        const position = getPos();
        if (typeof position === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, language: language.value.trim().replace(/[\r\n`]/g, '') || null }));
      });
      return {
        dom, contentDOM,
        update(next) { if (next.type !== node.type) return false; node = next; sync(); return true; },
        stopEvent: event => bar.contains(event.target as globalThis.Node),
        ignoreMutation: mutation => mutation.type !== 'selection' && !pre.contains(mutation.target),
      };
    };
  },
}).configure({ enableTabIndentation: true, tabSize: 2 });

export function createEditorExtensions(images?: EditorImages): Extensions {
  const SafeImage = Image.extend({
    renderMarkdown(node) {
      const alt = String(node.attrs?.alt ?? '').replace(/[\\\[\]]/g, '\\$&');
      const source = String(node.attrs?.src ?? '').replace(/[\s()<>"]/g, char => encodeURIComponent(char).replace(/\(/g, '%28').replace(/\)/g, '%29'));
      const title = String(node.attrs?.title ?? '').replace(/[\\"]/g, '\\$&');
      return `![${alt}](${source}${title ? ` "${title}"` : ''})`;
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span'); dom.className = 'rich-image';
        dom.contentEditable = 'false';
        const sync = () => {
          const source = String(node.attrs.src ?? '');
          const resolved = images?.resolve(source);
          dom.replaceChildren();
          dom.title = source.startsWith('data:') ? String(node.attrs.alt || '埋め込み画像') : source;
          if (resolved) {
            const image = document.createElement('img');
            image.alt = node.attrs.alt ?? ''; image.referrerPolicy = 'no-referrer'; image.src = resolved;
            dom.append(image);
          } else {
            const placeholder = document.createElement('span'); placeholder.className = 'image-placeholder';
            placeholder.textContent = `画像: ${node.attrs.alt || source}`; dom.append(placeholder);
          }
        };
        sync();
        const unregister = images?.registerRefresh?.(sync);
        return { dom, update(next) { if (next.type !== node.type) return false; node = next; sync(); return true; }, destroy: unregister };
      };
    },
  }).configure({ inline: true, allowBase64: true });
  return [
    StarterKit.configure({ paragraph: false, codeBlock: false, underline: false, link: { openOnClick: false, autolink: false } }),
    ImageParagraph, EditableCode, SafeImage, RawInline, RawBlock,
    TableKit.configure({ table: { resizable: false } }),
    TaskList, TaskItem.configure({ nested: true, a11y: { checkboxLabel: node => `タスク: ${node.textContent || '未入力'}` } }),
    Markdown.configure({ marked: new Marked() as unknown as NonNullable<Parameters<typeof Markdown.configure>[0]>['marked'], markedOptions: { gfm: true, breaks: false } }),
  ];
}
