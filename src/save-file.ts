import { isDesktop } from './platform';
import { exportJobs } from './export-jobs';
import { validateDocumentContent } from './document-input';
interface WritableFile {
  write(content: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
interface FileHandle {
  createWritable(): Promise<WritableFile>;
}
type SavePicker = (options: {
  suggestedName: string;
  types: {
    description: string;
    accept: Record<string, string[]>;
  }[];
}) => Promise<FileHandle>;
export type SaveResult = 'saved' | 'downloaded' | 'cancelled' | 'print-dialog';
export function exportFileName(name: string, extension: string): string {
  let stem = Array.from(name.replace(/^.*[/\\]/, '').replace(/\.(md|markdown|txt|mdown|mkd|html|svg|pdf)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')).slice(0, 100).join('').replace(/[. ]+$/, '') || 'document';
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return `${stem}.${extension}`;
}

/** Ask for the destination before async rendering consumes browser user activation. */
export function exportTextFile(options: {
  name: string;
  description: string;
  mime: string;
  extensions: string[];
  content: string | (() => Promise<string>);
}): Promise<SaveResult> {
  return exportJobs.run(() => saveTextFile(options));
}
async function saveTextFile(options: Parameters<typeof exportTextFile>[0]): Promise<SaveResult> {
  const {
    name: suggestedName,
    description,
    mime,
    extensions
  } = options;
  const getContent = () => typeof options.content === 'string' ? Promise.resolve(options.content) : options.content();
  if (isDesktop) {
    const {
      invoke
    } = await import('@tauri-apps/api/core');
    const kind = mime === 'text/markdown' ? 'markdown' : mime === 'image/svg+xml' ? 'svg' : mime === 'text/html' ? 'html' : undefined;
    if (!kind) throw new Error('対応していない保存形式です。');
    const ticket = await invoke<string | null>('begin_export', {
      name: suggestedName,
      kind
    });
    if (!ticket) return 'cancelled';
    try {
      await invoke('finish_export', {
        ticket,
        content: await getContent()
      });
      return 'saved';
    } finally {
      await invoke('cancel_export', {
        ticket
      });
    }
  }
  const picker = import.meta.env?.MODE === 'portable' ? undefined : (window as Window & {
    showSaveFilePicker?: SavePicker;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName,
        types: [{
          description,
          accept: {
            [mime]: extensions
          }
        }]
      });
      const blob = new Blob([await getContent()], {
        type: `${mime};charset=utf-8`
      });
      const stream = await handle.createWritable();
      try {
        await stream.write(blob);
        await stream.close();
      } catch (error) {
        await stream.abort?.();
        throw error;
      }
      return 'saved';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  const blob = new Blob([await getContent()], {
    type: `${mime};charset=utf-8`
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
export function exportPdfFile(name: string, html: () => Promise<string>): Promise<SaveResult> {
  return exportJobs.run(async () => {
    if (isDesktop) {
      const {
        invoke
      } = await import('@tauri-apps/api/core');
      const ticket = await invoke<string | null>('begin_export', {
        name: exportFileName(name, 'pdf'),
        kind: 'pdf'
      });
      if (!ticket) return 'cancelled';
      try {
        await invoke('finish_pdf', {
          ticket,
          html: await html()
        });
        return 'saved';
      } finally {
        await invoke('cancel_export', {
          ticket
        });
      }
    }
    // Browsers expose PDF through their print dialog. Prepare a separate inert
    // document so editing/view mode and lazy images cannot change the output.
    const frame = document.createElement('iframe');
    frame.title = 'PDF出力';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:800px;border:0';
    try {
      const content = await html();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('PDFの印刷用文書を読み込めませんでした。')), 20_000);
        frame.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
        frame.srcdoc = content;
        document.body.append(frame);
      });
      const doc = frame.contentDocument;
      const view = frame.contentWindow;
      if (!doc || !view) throw new Error('PDFの印刷画面を開けませんでした。');
      let imageTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all([doc.fonts.ready, ...Array.from(doc.images, image => image.decode())]), new Promise((_, reject) => {
          imageTimeout = setTimeout(() => reject(new Error('PDFの画像を読み込めませんでした。')), 20_000);
        })]);
      } finally {
        clearTimeout(imageTimeout);
      }
      view.focus();
      view.print();
      // print() blocks in supported desktop browsers until the dialog closes.
      // Keep the frame briefly for browsers whose print dialog returns early.
      setTimeout(() => frame.remove(), 60_000);
      return 'print-dialog';
    } catch (error) {
      frame.remove();
      throw error;
    }
  });
}
export async function exportMarkdown(name: string, content: string): Promise<SaveResult> {
  validateDocumentContent(content);
  return exportTextFile({
    name: exportFileName(name, 'md'),
    content,
    description: 'Markdownファイル',
    mime: 'text/markdown',
    extensions: ['.md', '.markdown']
  });
}
