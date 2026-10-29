import { buildWorkspaceTree, type WorkspaceEntry, type WorkspaceNode } from './tree-model';
import { escapeHtml } from './markdown';
import { icon } from './icons';

interface TreeOptions {
  expandedPaths: string[];
  onOpen(path: string): void;
  onSelectFolder?(path: string): void;
  onRemove?(path: string): void;
  onExpandedChange(paths: string[]): void;
}

export class WorkspaceTree {
  private root = buildWorkspaceTree([]);
  private expanded: Set<string>;
  private selected?: string;
  private focused = '';
  private available = new Set<string>();
  private count = 0;

  constructor(private element: HTMLElement, private options: TreeOptions) {
    this.expanded = new Set(options.expandedPaths);
    element.addEventListener('click', event => {
      const row = (event.target as Element).closest<HTMLElement>('[data-tree-row]');
      if (!row) return;
      const path = row.dataset.treeRow!;
      this.focus(path);
      if ((event.target as Element).closest('[data-remove-tree]')) { event.preventDefault(); options.onRemove?.(path); return; }
      const item = row.parentElement!;
      if (item.dataset.kind === 'folder') { options.onSelectFolder?.(path); this.toggle(path); }
      else options.onOpen(path);
    });
    element.addEventListener('keydown', event => this.onKey(event));
    element.addEventListener('focusin', event => {
      const item = (event.target as Element).closest<HTMLElement>('[data-tree-path]');
      if (item) {
        this.focused = item.dataset.treePath!;
        this.items().forEach(node => { node.tabIndex = node === item ? 0 : -1; });
      }
    });
  }

  setEntries(paths: Iterable<WorkspaceEntry>, selected: string | undefined, available: Set<string>): void {
    const entries = [...paths];
    this.root = buildWorkspaceTree(entries);
    this.count = entries.filter(entry => entry.kind !== 'folder').length;
    this.selected = selected;
    this.available = available;
    this.render();
  }

  reveal(path: string): void {
    this.expanded.add('');
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) this.expanded.add(parts.slice(0, index).join('/'));
    this.options.onExpandedChange([...this.expanded]);
  }

  reset(): void {
    this.expanded = new Set(['']);
    this.focused = '';
    this.options.onExpandedChange(['']);
  }

  private items(): HTMLElement[] { return Array.from(this.element.querySelectorAll<HTMLElement>('[data-tree-path]')); }

  focus(path: string): void {
    const item = this.items().find(item => item.dataset.treePath === path);
    if (item) {
      this.focused = path;
      this.items().forEach(node => { node.tabIndex = node === item ? 0 : -1; });
      item.focus({ preventScroll: true });
    }
  }

  private toggle(path: string): void {
    if (this.expanded.has(path)) this.expanded.delete(path); else this.expanded.add(path);
    this.focused = path;
    this.options.onExpandedChange([...this.expanded]);
    this.render();
  }

  private render(): void {
    const restoreFocus = this.element.contains(document.activeElement);
    const row = (node: WorkspaceNode, level: number): string => {
      const folder = node.kind === 'folder';
      const expanded = folder && this.expanded.has(node.path);
      const selected = this.selected === node.path;
      const unavailable = !folder && !this.available.has(node.path);
      const title = node.path ? `${node.path}${unavailable ? '\nフォルダーを開き直して読み込む' : ''}` : 'ワークエリア';
      const remove = node.path && this.options.onRemove ? `<button type="button" class="tree-delete" data-remove-tree title="ワークから削除" aria-label="${escapeHtml(node.name)}を削除" tabindex="-1">${icon('trash')}</button>` : '';
      return `<div role="treeitem" class="tree-item" aria-label="${escapeHtml(node.name)}" aria-level="${level}" ${folder ? `aria-expanded="${expanded}"` : ''} aria-selected="${selected}" data-tree-path="${escapeHtml(node.path)}" data-kind="${node.kind}" tabindex="${node.path === this.focused ? '0' : '-1'}"><div class="tree-row ${selected ? 'selected' : ''} ${unavailable ? 'unavailable' : ''} ${level === 1 ? 'tree-root' : ''}" data-tree-row="${escapeHtml(node.path)}" style="--tree-depth:${level - 1}" title="${escapeHtml(title)}"><span class="tree-caret ${expanded ? 'expanded' : ''}">${folder ? icon('chevron') : ''}</span>${icon(folder ? expanded ? 'folder' : 'folderClosed' : node.kind === 'image' ? 'image' : node.kind === 'markdown' ? 'file' : 'genericFile')}<span class="tree-name">${escapeHtml(node.name)}</span>${level === 1 ? `<span class="tree-count">${this.count}</span>` : selected ? '<span class="active-dot"></span>' : ''}${remove}</div>${expanded && node.children.length ? `<div role="group" class="tree-group">${node.children.map(child => row(child, level + 1)).join('')}</div>` : ''}</div>`;
    };
    this.element.innerHTML = row(this.root, 1) + (!this.root.children.length ? '<p class="workspace-empty">ファイルやフォルダーを開くと<br />ここに表示されます。</p>' : '');
    this.element.querySelectorAll<HTMLElement>('.tree-item:not([data-kind="folder"]) > [data-tree-row]').forEach(element => { element.draggable = true; });
    const items = this.items();
    if (!items.some(item => item.tabIndex === 0)) {
      this.focused = this.selected && items.some(item => item.dataset.treePath === this.selected) ? this.selected : '';
      items.find(item => item.dataset.treePath === this.focused)!.tabIndex = 0;
    }
    if (restoreFocus) this.focus(this.focused);
  }

  private onKey(event: KeyboardEvent): void {
    if ((event.target as Element).closest('[data-remove-tree]') && ['Enter', ' '].includes(event.key)) return;
    const item = (event.target as Element).closest<HTMLElement>('[data-tree-path]');
    if (!item) return;
    const path = item.dataset.treePath!;
    const items = this.items();
    const index = items.indexOf(item);
    const folder = item.dataset.kind === 'folder';
    if (event.key === 'Delete' && path && this.options.onRemove) { event.preventDefault(); event.stopPropagation(); this.options.onRemove(path); return; }
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowDown') this.focus(items[Math.min(index + 1, items.length - 1)].dataset.treePath!);
    else if (event.key === 'ArrowUp') this.focus(items[Math.max(index - 1, 0)].dataset.treePath!);
    else if (event.key === 'Home') this.focus('');
    else if (event.key === 'End') this.focus(items.at(-1)!.dataset.treePath!);
    else if (event.key === 'ArrowRight' && folder) {
      if (!this.expanded.has(path)) this.toggle(path);
      else if (item.querySelector('[role="group"] > [data-tree-path]')) this.focus((item.querySelector<HTMLElement>('[role="group"] > [data-tree-path]')!).dataset.treePath!);
    } else if (event.key === 'ArrowLeft') {
      if (folder && this.expanded.has(path)) this.toggle(path);
      else this.focus(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (folder) { this.options.onSelectFolder?.(path); this.toggle(path); } else this.options.onOpen(path);
    }
  }
}
