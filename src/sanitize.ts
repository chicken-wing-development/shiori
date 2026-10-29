import DOMPurify from 'dompurify';

/** Keep only image object URLs created by the local workspace during this render. */
export function sanitizeMarkdown(html: string, localImageUrls: ReadonlySet<string> = new Set()): string {
  // Use a separate instance so this image rule cannot affect Mermaid SVGs.
  const sanitizer = DOMPurify();
  sanitizer.addHook('uponSanitizeAttribute', (element, attribute) => {
    if (
      element.nodeName === 'IMG' &&
      attribute.attrName === 'src' &&
      attribute.attrValue.startsWith('blob:') &&
      localImageUrls.has(attribute.attrValue)
    ) {
      attribute.forceKeepAttr = true;
    }
  });
  return sanitizer.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form'],
  });
}
