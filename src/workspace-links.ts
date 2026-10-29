import { fromMarkdown } from 'mdast-util-from-markdown';
import { resolveLocalPath } from './files.ts';

type MarkdownNode = { type: string; url?: string; children?: MarkdownNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };

export function destinationRange(raw: string, definition: boolean): [number, number] | undefined {
  let index = raw.startsWith('![') ? 1 : 0;
  if (raw[index] !== '[') return;
  let depth = 0;
  for (; index < raw.length; index++) {
    if (raw[index] === '\\') { index++; continue; }
    if (raw[index] === '`') {
      const run = /^`+/.exec(raw.slice(index))![0];
      const end = raw.indexOf(run, index + run.length);
      if (end !== -1) { index = end + run.length - 1; continue; }
    }
    if (raw[index] === '[') depth++;
    if (raw[index] === ']' && --depth === 0) { index++; break; }
  }
  while (/\s/.test(raw[index] ?? '') && index < raw.length) index++;
  if (raw[index++] !== (definition ? ':' : '(')) return;
  while (/\s/.test(raw[index] ?? '') && index < raw.length) index++;
  const angle = raw[index] === '<';
  const start = angle ? ++index : index;
  depth = 0;
  for (; index < raw.length; index++) {
    const char = raw[index];
    if (char === '\\') { index++; continue; }
    if (angle ? char === '>' : (depth === 0 && (char === ')' || /\s/.test(char)))) return [start, index];
    if (!angle && char === '(') depth++;
    else if (!angle && char === ')') depth--;
  }
  if (definition && !angle) return [start, index];
}

export function relativeWorkspacePath(fromDocument: string, target: string): string {
  const base = fromDocument.split('/').slice(0, -1);
  const parts = target.split('/');
  while (base.length && parts.length && base[0] === parts[0]) { base.shift(); parts.shift(); }
  return [...base.map(() => '..'), ...parts].map(part => part === '..' ? part : encodeURIComponent(part).replace(/[()']/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

/** Only destination spans change: prose, code, link labels and Markdown style remain intact. */
export function rewriteWorkspaceLinks(content: string, oldBase: string, newBase: string, source: string, destination: string): string {
  const edits: { start: number; end: number; value: string }[] = [];
  const visit = (node: MarkdownNode): void => {
    if (node.url && ['image', 'link', 'definition'].includes(node.type) && !/^[?#]/.test(node.url)) {
      const resolved = resolveLocalPath(oldBase, node.url);
      const moved = resolved === source;
      if (resolved && (moved || (oldBase !== newBase && !node.url.startsWith('/')))) {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) {
          const range = destinationRange(content.slice(start, end), node.type === 'definition');
          if (range) {
            const target = moved ? destination : resolved;
            const suffix = node.url.match(/[?#][\s\S]*$/)?.[0] ?? '';
            const value = (node.url.startsWith('/') ? `/${relativeWorkspacePath('root.md', target)}` : relativeWorkspacePath(newBase, target)) + suffix;
            edits.push({ start: start + range[0], end: start + range[1], value });
          }
        }
      }
    }
    node.children?.forEach(visit);
  };
  visit(fromMarkdown(content));
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.value + content.slice(edit.end);
  return content;
}
