import DOMPurify from 'dompurify';

/** SVGs are also opened as standalone files, so strip active and external content. */
export function sanitizeDiagramSvg(markup: string): string {
  const clean = DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'image', 'feImage', 'a', 'script', 'animate', 'animateMotion', 'animateTransform', 'set'],
  });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('SVGを生成できませんでした。');
  const safeCss = (value: string): boolean => {
    const css = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : char);
    const withoutLocalUrls = css.replace(/url\s*\(\s*['"]?#[\w:.-]+['"]?\s*\)/gi, '');
    return !/@import|@font-face|(?:https?|data|file):/i.test(css) && !/url\s*\(/i.test(withoutLocalUrls);
  };
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    if (element.localName === 'style' && !safeCss(element.textContent ?? '')) element.remove();
    for (const attr of Array.from(element.attributes)) {
      if ((attr.localName === 'href' && !attr.value.startsWith('#')) || ((/^(?:style|fill|stroke|filter|clip-path|mask|cursor|marker-start|marker-end|marker-mid)$/.test(attr.name) || /url\s*\(/i.test(attr.value)) && !safeCss(attr.value))) element.removeAttributeNode(attr);
    }
  }
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Mermaidダイアグラム');
  // Mermaid often uses width="100%". A fixed intrinsic size makes standalone
  // SVGs and SVGs embedded in other applications retain their aspect ratio.
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    svg.setAttribute('width', String(Math.ceil(viewBox[2])));
    svg.setAttribute('height', String(Math.ceil(viewBox[3])));
  }
  return new XMLSerializer().serializeToString(svg);
}
