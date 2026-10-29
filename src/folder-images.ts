import { isImageFile, isMarkdownFile, resolveLocalPath } from './files.ts';
import type { ReaderDocument } from './types';

/** Resolve a picked document folder, common ancestor, or the image folder itself. */
export function selectFolderImages(files: File[], document: ReaderDocument, sources: string[]): {
  base: string;
  assets: {
    path: string;
    file: File;
  }[];
} {
  const relative = (file: File) => file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
  const documents = files.filter(file => isMarkdownFile(file.name) && file.name === document.name);
  const base = documents.length === 1 ? relative(documents[0]) : document.path ?? document.name;
  const stripped = new Map(files.filter(file => isImageFile(file.name)).map(file => [relative(file), file]));
  const rooted = new Map(files.filter(file => isImageFile(file.name)).map(file => [file.webkitRelativePath || file.name, file]));
  const assets: {
    path: string;
    file: File;
  }[] = [];
  let size = 0;
  for (const source of sources.slice(0, 100)) {
    const path = resolveLocalPath(base, source);
    if (!path || assets.some(asset => asset.path === path)) continue;
    const file = stripped.get(path) ?? rooted.get(path);
    if (!file || file.size > 8 * 1024 * 1024 || size + file.size > 32 * 1024 * 1024) continue;
    size += file.size;
    assets.push({
      path,
      file
    });
  }
  // Keep other explicitly picked images available for references added later.
  for (const [path, file] of [...stripped, ...rooted]) {
    if (assets.length >= 100) break;
    if (assets.some(asset => asset.path === path)) continue;
    const addedBytes = assets.some(asset => asset.file === file) ? 0 : file.size;
    if (file.size > 8 * 1024 * 1024 || size + addedBytes > 32 * 1024 * 1024) continue;
    size += addedBytes;
    assets.push({
      path,
      file
    });
  }
  return {
    base,
    assets
  };
}
