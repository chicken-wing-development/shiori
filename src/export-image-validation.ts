const INVALID_IMAGE = '画像のデータが不正か、対応していない形式です。';
const MAX_PIXELS = 32 * 1024 * 1024;

/** File extensions and HTTP headers are claims, not proof of an image format. */
export function validateRasterSignature(bytes: Uint8Array, mime: string): void {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let valid = false;
  switch (mime) {
    case 'image/png': valid = starts(137, 80, 78, 71, 13, 10, 26, 10); break;
    case 'image/jpeg': valid = starts(255, 216, 255); break;
    case 'image/gif': valid = ['GIF87a', 'GIF89a'].includes(ascii(0, 6)); break;
    case 'image/webp': valid = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'; break;
    case 'image/avif': {
      // ISO BMFF file type box: require an AVIF major or compatible brand.
      if (bytes.length < 16 || ascii(4, 4) !== 'ftyp') break;
      const end = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
      if (end < 16 || end > bytes.length || end % 4 !== 0) break;
      valid = ['avif', 'avis'].includes(ascii(8, 4));
      for (let offset = 16; offset < end; offset += 4) valid ||= ['avif', 'avis'].includes(ascii(offset, 4));
      break;
    }
  }
  if (!valid) throw new Error(INVALID_IMAGE);
}

/** A recognizable header can still contain truncated or corrupt pixel data. */
export async function validateExportImage(data: string): Promise<void> {
  const image = new Image();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    image.src = data;
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(INVALID_IMAGE)), 15_000); }),
    ]);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(INVALID_IMAGE);
    if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error('参照画像は1枚32メガピクセルまでです。');
  } catch (error) {
    if (error instanceof Error && error.message.includes('メガピクセル')) throw error;
    throw new Error(INVALID_IMAGE);
  } finally {
    clearTimeout(timeout);
    image.removeAttribute('src');
  }
}
