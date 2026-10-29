import { isImageFile, isMarkdownFile } from './files.ts';

export interface WorkspaceEntry {
  path: string;
  documentId?: string;
  kind?: 'folder';
  assetId?: string;
}

export interface WorkspaceNode {
  path: string;
  name: string;
  kind: 'folder' | 'markdown' | 'image' | 'file';
  children: WorkspaceNode[];
}

export function normalizeWorkspacePath(path: string): string | undefined {
  const parts = path.replace(/\\/g, '/').split('/').filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..' || part.includes('\0'))) return undefined;
  return parts.join('/');
}

export function buildWorkspaceTree(paths: Iterable<string | WorkspaceEntry>): WorkspaceNode {
  const root: WorkspaceNode = { path: '', name: 'ワークエリア', kind: 'folder', children: [] };
  const nodes = new Map<string, WorkspaceNode>([['', root]]);
  for (const entry of paths) {
    const rawPath = typeof entry === 'string' ? entry : entry.path;
    const path = normalizeWorkspacePath(rawPath);
    if (!path) continue;
    const parts = path.split('/');
    let parent = root;
    for (let index = 0; index < parts.length; index++) {
      const currentPath = parts.slice(0, index + 1).join('/');
      const directory = index < parts.length - 1 || (typeof entry !== 'string' && entry.kind === 'folder');
      let node = nodes.get(currentPath);
      if (!node) {
        node = { path: currentPath, name: parts[index], kind: directory ? 'folder' : isMarkdownFile(path) ? 'markdown' : isImageFile(path) ? 'image' : 'file', children: [] };
        nodes.set(currentPath, node);
        parent.children.push(node);
      }
      // A file and folder with the same virtual path cannot share a tree slot.
      if (directory && node.kind !== 'folder') break;
      parent = node;
    }
  }
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
  const sort = (node: WorkspaceNode): void => {
    node.children.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || collator.compare(a.name, b.name));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function workspaceFolders(entries: Iterable<WorkspaceEntry>): string[] {
  const paths = [''];
  const visit = (node: WorkspaceNode): void => {
    for (const child of node.children) if (child.kind === 'folder') { paths.push(child.path); visit(child); }
  };
  visit(buildWorkspaceTree(entries));
  return paths;
}

export function validWorkspaceName(name: string): boolean {
  return Boolean(name.trim()) && !/^[.]{1,2}$/.test(name) && !/[\\/\u0000-\u001f]/.test(name);
}

export function availableWorkspacePath(parent: string, name: string, entries: Iterable<WorkspaceEntry>): string {
  if (!validWorkspaceName(name) || (parent && normalizeWorkspacePath(parent) !== parent)) throw new Error('ファイル名またはフォルダー名が不正です。');
  const paths = [...entries].map(entry => entry.path);
  const occupied = (path: string) => paths.some(existing => existing === path || existing.startsWith(`${path}/`));
  const prefix = parent ? `${parent}/` : '';
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let candidate = `${prefix}${name}`;
  for (let number = 2; occupied(candidate); number++) candidate = `${prefix}${stem} (${number})${extension}`;
  return candidate;
}
