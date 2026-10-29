import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import type { CompiledDocument, Diagram, Heading } from './types';

for (const [name, language] of Object.entries({ javascript, typescript, python, json, css, xml, bash, markdown, yaml })) {
  hljs.registerLanguage(name, language);
}

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export interface RenderOptions {
  allowRemoteImages?: boolean;
  resolveImage?: (source: string) => string | undefined;
  localImageHint?: string;
  forExport?: boolean;
}

export function headingSlug(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
}

export function compileMarkdown(source: string, options: RenderOptions = {}): CompiledDocument {
  const headings: Heading[] = [];
  const diagrams: Diagram[] = [];
  const slugs = new Set<string>();
  const parser = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false }).use(taskLists);
  const validateLink = parser.validateLink;
  // SVG images are displayed only through the caller's sanitizing resolver.
  parser.validateLink = url => /^data:image\/svg\+xml;base64,[a-z\d+/=]+$/i.test(url) || validateLink(url);

  parser.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (language === 'mermaid') {
      if (diagrams.length >= 30) {
        if (options.forExport) throw new Error('エクスポートできるMermaidは30個までです。');
        return '<p class="render-notice">Mermaidは1ファイルにつき30個まで表示できます。</p>';
      }
      const id = `diagram-${diagrams.length}`;
      diagrams.push({ id, source: token.content });
      if (options.forExport) return `<figure data-diagram="${id}"></figure>`;
      return `<figure class="diagram-card" data-diagram="${id}"><figcaption><span class="diagram-label"><span class="status-dot"></span>MERMAID</span><span class="diagram-actions"><button type="button" class="diagram-save" data-save-diagram title="SVGファイルとして保存">SVG保存</button><button type="button" class="diagram-expand" data-expand-diagram title="図を拡大" aria-label="図を拡大">↗</button></span></figcaption><div class="diagram-content" aria-live="polite"><span class="diagram-loading">図を描画しています…</span></div></figure>`;
    }
    const code = language && hljs.getLanguage(language) ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value : escapeHtml(token.content);
    if (options.forExport) return `<div class="code-block"><div class="code-language">${escapeHtml(language || 'text')}</div><pre><code class="hljs">${code}</code></pre></div>`;
    return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(language || 'text')}</span><button type="button" data-copy-code>コピー</button></div><pre><code class="hljs">${code}</code></pre></div>`;
  };

  const defaultLink = parser.renderer.rules.link_open ?? ((tokens, index, config, env, self) => self.renderToken(tokens, index, config));
  parser.renderer.rules.link_open = (tokens, index, config, env, self) => {
    const token = tokens[index];
    let href = String(token.attrGet('href') ?? '');
    // An exported HTML document is usually opened with file:. Preserve web
    // destinations explicitly, so network-path references never become UNC URLs.
    if (options.forExport && href.startsWith('//')) {
      try {
        const url = new URL(`https:${href}`);
        if (url.username || url.password || !url.hostname) throw new Error();
        href = url.href;
        token.attrSet('href', href);
      } catch {
        throw new Error('リンクのURLが不正です。https:// から始まるURLを指定してください。');
      }
    }
    if (/^https?:/i.test(href)) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    } else if (!options.forExport && href && !href.startsWith('#') && !/^mailto:/i.test(href)) {
      token.attrSet('data-local-link', href);
      token.attrSet('href', '#');
    }
    return defaultLink(tokens, index, config, env, self);
  };

  parser.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    const src = String(token.attrGet('src') ?? '');
    const alt = token.content;
    const remote = /^https?:\/\//i.test(src);
    const local = options.resolveImage?.(src);
    const safeData = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(src);
    const resolved = local ?? (safeData || (remote && options.allowRemoteImages) ? src : undefined);
    if (!resolved) return `<span class="image-placeholder">${remote ? '外部画像' : '画像'}: ${escapeHtml(alt || src)}<small>${remote ? '上部の「外部画像」を許可すると表示します' : escapeHtml(options.localImageHint ?? '「その他 → 参照画像のフォルダー」で画像の場所を指定してください')}</small></span>`;
    return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" loading="${options.forExport ? 'eager' : 'lazy'}" referrerpolicy="no-referrer" />`;
  };

  const tokens = parser.parse(source.replace(/^\uFEFF/, ''), {});
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type !== 'heading_open') continue;
    const inline = tokens[index + 1];
    const text = inline?.children?.filter(t => ['text', 'code_inline', 'emoji'].includes(t.type)).map(t => t.content).join('') || inline?.content || '';
    const base = headingSlug(text);
    let id = base;
    let suffix = 1;
    while (slugs.has(id)) id = `${base}-${suffix++}`;
    slugs.add(id);
    tokens[index].attrSet('id', id);
    headings.push({ id, text, level: Number(tokens[index].tag.slice(1)) });
  }
  return { html: parser.renderer.render(tokens, parser.options, {}), headings, diagrams, characters: Array.from(source).length, lines: source.split('\n').length };
}
