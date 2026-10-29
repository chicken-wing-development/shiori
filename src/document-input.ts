export const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024;
export const DOCUMENT_SIZE_MESSAGE = '文書はUTF-8で2 MB以下にしてください。直前の内容を保持しました。';

export function validateDocumentContent(content: string): void {
  if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > MAX_DOCUMENT_SIZE) throw new Error(DOCUMENT_SIZE_MESSAGE);
}
