import { compileMarkdown, escapeHtml } from './markdown';
import { sanitizeMarkdown } from './sanitize';
import { renderDiagramSvg } from './diagrams';
import { svgData } from './image-data';
import { validateDocumentContent } from './document-input';
import { exportImage, MAX_ASSET_BYTES, MAX_HTML_BYTES, type ImageResolver } from './document-assets';
import styles from './export-document.css?inline';
export const EXPORT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export interface HtmlDocument {
  content: string;
  images: number;
  diagrams: number;
}

/** Build an inert, offline document from a snapshot, never from the live editor DOM. */
export async function buildHtmlDocument(content: string, options: {
  title: string;
  resolveImageFile?: ImageResolver;
}): Promise<HtmlDocument> {
  validateDocumentContent(content);
  const occurrences = new Map<string, number>();
  let imageCount = 0;
  const initial = compileMarkdown(content, {
    forExport: true,
    resolveImage: source => {
      if (++imageCount > 100) throw new Error('エクスポートできる画像は100個までです。');
      occurrences.set(source, (occurrences.get(source) ?? 0) + 1);
      return undefined;
    }
  });
  const images = new Map<string, string>();
  let assetBytes = 0;
  let outputBytes = new TextEncoder().encode(initial.html).length + styles.length + 1024;
  for (const [source, count] of occurrences) {
    const image = await exportImage(source, options.resolveImageFile);
    assetBytes += image.bytes;
    outputBytes += image.data.length * count;
    if (assetBytes > MAX_ASSET_BYTES) throw new Error('参照画像は合計32 MBまでです。');
    if (outputBytes > MAX_HTML_BYTES) throw new Error('エクスポートするHTMLは64 MBまでです。');
    images.set(source, image.data);
  }
  const compiled = compileMarkdown(content, {
    forExport: true,
    resolveImage: source => images.get(source)
  });
  const template = document.createElement('template');
  template.innerHTML = sanitizeMarkdown(compiled.html);
  for (const [index, diagram] of compiled.diagrams.entries()) {
    const figure = template.content.querySelector(`[data-diagram="${diagram.id}"]`);
    if (!figure) throw new Error('図の出力位置を確認できませんでした。');
    const data = svgData(await renderDiagramSvg(diagram.source, 'light'));
    outputBytes += data.length;
    if (outputBytes > MAX_HTML_BYTES) throw new Error('エクスポートするHTMLは64 MBまでです。');
    figure.className = 'mermaid-figure';
    figure.removeAttribute('data-diagram');
    const image = document.createElement('img');
    image.src = data;
    image.alt = `Mermaid図 ${index + 1}`;
    const caption = document.createElement('figcaption');
    caption.textContent = image.alt;
    figure.replaceChildren(image, caption);
  }
  const title = escapeHtml(options.title.replace(/[\u0000-\u001f]/g, ' ').slice(0, 240) || 'Markdown');
  const html = `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(EXPORT_CSP)}"><meta name="referrer" content="no-referrer"><title>${title}</title><style>${styles}</style></head><body><main>${template.innerHTML}</main></body></html>\n`;
  if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) throw new Error('エクスポートするHTMLは64 MBまでです。');
  return {
    content: html,
    images: imageCount,
    diagrams: compiled.diagrams.length
  };
}
