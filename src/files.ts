import type { ReaderDocument } from './types';
import { MAX_DOCUMENT_SIZE, validateDocumentContent } from './document-input.ts';
export { MAX_DOCUMENT_SIZE } from './document-input.ts';
export const isMarkdownFile = (name: string): boolean => /\.(md|markdown|mdown|mkd|txt)$/i.test(name);
export const isImageFile = (name: string): boolean => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name);
export function resolveLocalPath(base: string, target: string): string | undefined {
  if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split(/[?#]/)[0]);
  } catch {
    return undefined;
  }
  if (/^(?:[a-z][\w+.-]*:|[\\/]{2})/i.test(decoded) || /[\u0000-\u001f\u007f:]/.test(decoded)) return undefined;
  if (!decoded) return undefined;
  const parts: string[] = decoded.startsWith('/') ? [] : base.replace(/\\/g, '/').split('/').slice(0, -1);
  for (const part of decoded.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}
export class FileWorkspace {
  private files = new Map<string, File>();
  private urls = new Map<string, string>();
  addFiles(files: File[]): void {
    const roots = new Set(files.filter(file => file.webkitRelativePath).map(file => file.webkitRelativePath.split('/')[0]));
    for (const path of this.files.keys()) {
      if (roots.has(path.split('/')[0])) {
        const url = this.urls.get(path);
        if (url) URL.revokeObjectURL(url);
        this.urls.delete(path);
        this.files.delete(path);
      }
    }
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      const previous = this.urls.get(path);
      if (previous) URL.revokeObjectURL(previous);
      this.urls.delete(path);
      this.files.set(path, file);
    }
  }
  getFile(path: string): File | undefined {
    return this.files.get(path);
  }
  setFile(path: string, file: File): void {
    const previous = this.urls.get(path);
    if (previous) URL.revokeObjectURL(previous);
    this.urls.delete(path);
    this.files.set(path, file);
  }
  removeFile(path: string): void {
    const url = this.urls.get(path);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(path);
    this.files.delete(path);
  }
  getPaths(): string[] {
    return [...this.files.keys()];
  }
  resolveFile(base: string, href: string): File | undefined {
    const path = resolveLocalPath(base, href);
    return path ? this.files.get(path) : undefined;
  }
  resolveImage(base: string, href: string): string | undefined {
    const path = resolveLocalPath(base, href);
    return path ? this.getImageUrl(path) : undefined;
  }
  getImageUrl(path: string): string | undefined {
    const file = this.files.get(path);
    if (!file || !isImageFile(file.name)) return undefined;
    if (/\.svg$/i.test(file.name)) return this.urls.get(path);
    if (!this.urls.has(path)) this.urls.set(path, URL.createObjectURL(file));
    return this.urls.get(path);
  }
  async prepareImage(path: string): Promise<void> {
    const file = this.files.get(path);
    if (!file || !/\.svg$/i.test(file.name) || this.urls.has(path)) return;
    const {
      sanitizeDiagramSvg
    } = await import('./svg');
    const clean = sanitizeDiagramSvg(await file.text());
    if (this.files.get(path) !== file || this.urls.has(path)) return;
    this.urls.set(path, URL.createObjectURL(new Blob([clean], {
      type: 'image/svg+xml'
    })));
  }
  dispose(): void {
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.urls.clear();
    this.files.clear();
  }
}
export async function readDocument(file: File, existingId?: string, workspacePath?: string): Promise<ReaderDocument> {
  if (!isMarkdownFile(file.name)) throw new Error('Markdownファイル（.md / .markdown / .txt）を選択してください。');
  if (file.size > MAX_DOCUMENT_SIZE) throw new Error(`${file.name}: 2 MB以下のファイルを選択してください。`);
  const path = workspacePath ?? (file.webkitRelativePath || file.name);
  let content: string;
  try {
    content = new TextDecoder('utf-8', {
      fatal: true
    }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('UTF-8のMarkdownファイルを選択してください。');
  }
  validateDocumentContent(content);
  return {
    id: existingId ?? crypto.randomUUID(),
    name: path.split('/').at(-1)!,
    path,
    content,
    openedAt: Date.now(),
    origin: 'local'
  };
}
