import fs from 'node:fs';
import * as zlib from 'node:zlib';

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(bytes);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Standard ZIP with UTF-8 filenames and regular files. No symlink privileges are needed.
export function writeZip(destination, entries) {
  if (entries.length > 65535) throw new Error('This release exceeds the standard ZIP entry limit.');
  const fd = fs.openSync(`${destination}.partial`, 'w');
  let offset = 0;
  const central = [];
  const write = bytes => {
    let written = 0;
    while (written < bytes.length) written += fs.writeSync(fd, bytes, written, bytes.length - written);
    offset += bytes.length;
    if (offset > 0xffffffff) throw new Error('This release exceeds the standard ZIP size limit.');
  };
  try {
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!entry.name || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..')) throw new Error(`Unsafe ZIP path: ${entry.name}`);
      const name = Buffer.from(entry.name, 'utf8');
      const content = entry.data ?? fs.readFileSync(entry.file);
      const compressed = zlib.deflateRawSync(content, { level: 6 });
      const method = compressed.length < content.length ? 8 : 0;
      const payload = method ? compressed : content;
      const crc = crc32(content);
      const localOffset = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x800, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(33, 12); // Stable DOS date: 1980-01-01.
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(payload.length, 18);
      local.writeUInt32LE(content.length, 22);
      local.writeUInt16LE(name.length, 26);
      write(Buffer.concat([local, name, payload]));
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(0x314, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x800, 8);
      header.writeUInt16LE(method, 10);
      header.writeUInt16LE(33, 14);
      header.writeUInt32LE(crc, 16);
      header.writeUInt32LE(payload.length, 20);
      header.writeUInt32LE(content.length, 24);
      header.writeUInt16LE(name.length, 28);
      header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      header.writeUInt32LE(localOffset, 42);
      central.push(header, name);
      if (index > 0 && index % 6000 === 0) console.log(`  ${index}/${entries.length} files archived`);
    }
    const centralOffset = offset;
    write(Buffer.concat(central));
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - centralOffset, 12);
    end.writeUInt32LE(centralOffset, 16);
    write(end);
  } finally { fs.closeSync(fd); }
  fs.renameSync(`${destination}.partial`, destination);
}
