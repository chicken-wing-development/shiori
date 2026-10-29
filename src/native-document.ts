import { invoke } from '@tauri-apps/api/core';
import { resolveLocalPath } from './files';
import type { ReaderDocument } from './types';
export interface NativeOpenedDocument {
  token: string;
  name: string;
  content: string;
}
interface NativeImage {
  name: string;
  mime: string;
  data: string;
}
export class NativeDocument {
  readonly token: string;
  private requests = new Map<string, Promise<File | undefined>>();
  constructor(token: string) {
    this.token = token;
  }
  async image(source: string): Promise<File | undefined> {
    const path = resolveLocalPath('document.md', source);
    if (!path || /^[\\/]/.test(source)) return;
    if (!this.requests.has(path)) {
      // Cache failures too, to avoid repeated IPC on every preview render.
      if (this.requests.size >= 100) return;
      this.requests.set(path, invoke<NativeImage>('read_document_image', {
        token: this.token,
        source
      }).then(image => {
        const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
        return new File([bytes], image.name, {
          type: image.mime
        });
      }).catch(() => undefined));
    }
    return this.requests.get(path);
  }
  async close(): Promise<void> {
    await invoke('close_document', {
      token: this.token
    });
  }
}
export function nativeReaderDocument(value: NativeOpenedDocument): ReaderDocument {
  return {
    id: crypto.randomUUID(),
    name: value.name,
    path: value.name,
    content: value.content,
    openedAt: Date.now(),
    origin: 'local'
  };
}
export function pickNativeDocument(): Promise<NativeOpenedDocument | null> {
  return invoke('open_document');
}
export async function rememberNativeDocument(token?: string): Promise<void> {
  await invoke('remember_document', {
    token: token ?? null
  });
}
export async function resumeNativeDocument(token: string): Promise<NativeDocument> {
  await invoke('resume_document', {
    token
  });
  return new NativeDocument(token);
}
