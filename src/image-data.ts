import { sanitizeDiagramSvg } from './svg';
export const rasterDataPattern = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z\d+/=\s]+$/i;
export const svgDataPattern = /^data:image\/svg\+xml;base64,[a-z\d+/=\s]+$/i;
export function base64Data(bytes: Uint8Array, mime: string): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return `data:${mime};base64,${btoa(parts.join(''))}`;
}
export function svgData(markup: string): string {
  return base64Data(new TextEncoder().encode(sanitizeDiagramSvg(markup)), 'image/svg+xml');
}

/** Never insert SVG markup from a document into the editor DOM. */
export function embeddedImage(source: string): string | undefined {
  if (rasterDataPattern.test(source)) return source;
  if (!svgDataPattern.test(source)) return;
  try {
    const bytes = Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), char => char.charCodeAt(0));
    return svgData(new TextDecoder('utf-8', {
      fatal: true
    }).decode(bytes));
  } catch {
    return;
  }
}
