import { fromMarkdown } from 'mdast-util-from-markdown';
import { base64Data, embeddedImage, svgData } from './image-data';
import { isDesktop } from './platform';
import { validateExportImage, validateRasterSignature } from './export-image-validation';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const MAX_HTML_BYTES = 64 * 1024 * 1024;
export type ImageResolver = (source: string) => File | undefined | Promise<File | undefined>;
type Node = {
  type: string;
  url?: string;
  identifier?: string;
  children?: Node[];
};
export function referencedImages(content: string): string[] {
  const nodes: Node[] = [];
  const visit = (node: Node) => {
    nodes.push(node);
    node.children?.forEach(visit);
  };
  visit(fromMarkdown(content));
  const definitions = new Map<string, string>();
  for (const node of nodes) if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  return [...new Set(nodes.filter(node => node.type === 'image' || node.type === 'imageReference').map(node => node.url ?? definitions.get(node.identifier ?? '')).filter((url): url is string => Boolean(url)))];
}
async function remoteImage(source: string): Promise<{
  bytes: Uint8Array;
  mime: string;
}> {
  const url = new URL(source);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('画像のURLが不正です。');
  // Browser fetch cannot pin a validated DNS result. Never fall back to it:
  // a public-looking hostname can resolve/rebind to a private service.
  if (!isDesktop) throw new Error('ブラウザー版では外部URLの画像を安全に取得できません。画像をローカルに保存して相対パスで参照するか、Windows版で出力してください。');
  const { invoke } = await import('@tauri-apps/api/core');
  const image = await invoke<{ mime: string; data: string }>('fetch_export_image', { source: url.href });
  if (!/^image\/(?:png|jpeg|gif|webp|avif|svg\+xml)$/.test(image.mime)) throw new Error('対応していない画像形式です。');
  if (image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('参照画像は1枚8 MBまでです。');
  return { bytes: Uint8Array.from(atob(image.data), char => char.charCodeAt(0)), mime: image.mime };
}

/** Export assets never keep filesystem paths, blob URLs, or remote image URLs. */
export async function exportImage(source: string, resolve?: ImageResolver): Promise<{
  data: string;
  bytes: number;
}> {
  let bytes: Uint8Array;
  let mime: string;
  if (/^data:/i.test(source)) {
    const data = embeddedImage(source);
    if (!data) throw new Error('埋め込み画像の形式が不正です。');
    bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1).replace(/\s/g, '')), char => char.charCodeAt(0));
    mime = data.slice(5, data.indexOf(';')).toLowerCase().replace('image/jpg', 'image/jpeg');
  } else if (/^https?:\/\//i.test(source)) ({
    bytes,
    mime
  } = await remoteImage(source));else {
    const file = await resolve?.(source);
    if (!file) throw new Error(`参照画像が見つかりません: ${source}。文書を開き直すか「参照画像のフォルダー」を指定してください。`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error('参照画像は1枚8 MBまでです。');
    const extension = file.name.split('.').at(-1)!.toLowerCase();
    if (!/^(?:png|jpe?g|gif|webp|avif|svg)$/.test(extension)) throw new Error('対応していない画像形式です。');
    mime = `image/${extension === 'jpg' ? 'jpeg' : extension === 'svg' ? 'svg+xml' : extension}`;
    bytes = new Uint8Array(await file.arrayBuffer());
  }
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('参照画像は1枚8 MBまでです。');
  if (mime !== 'image/svg+xml') validateRasterSignature(bytes, mime);
  const data = mime === 'image/svg+xml' ? svgData(new TextDecoder('utf-8', {
    fatal: true
  }).decode(bytes)) : base64Data(bytes, mime);
  await validateExportImage(data);
  return {
    data,
    bytes: bytes.length
  };
}
