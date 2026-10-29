import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Convert the approved artwork without redrawing it. Keep the detailed logo
// used by the app header and About screen separate from OS/browser icons.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'assets/branding/shiori-app-icon-v1.png');
const staging = path.join(root, 'test-results/icon-refresh');
const native = path.join(staging, 'generated-native');
const web = path.join(staging, 'generated-web');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 180, 192, 256, 512];
function convert(input, output, pngSizes = []) {
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', input, '--output', output,
    ...pngSizes.flatMap(size => ['--png', String(size)]),
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Tauri icon conversion failed');
}
await fs.mkdir(staging, { recursive: true });
convert(source, native);
convert(source, web, sizes);
for (const entry of await fs.readdir(native, { withFileTypes: true })) {
  if (entry.isFile() && /\.(png|ico|icns)$/.test(entry.name)) {
    await fs.copyFile(path.join(native, entry.name), path.join(root, 'src-tauri/icons', entry.name));
  }
}
// Include intermediate Windows DPI sizes too; avoid making the shell resample
// a 16/24/32px frame when it requests a 20px or 40px icon.
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const frames = await Promise.all(icoSizes.map(size => fs.readFile(path.join(web, `${size}x${size}.png`))));
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = icoSizes[index] === 256 ? 0 : icoSizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
await fs.writeFile(path.join(root, 'src-tauri/icons/icon.ico'), Buffer.concat([directory, ...frames]));
for (const [name, size] of Object.entries({ 'favicon-64.png': 64, 'apple-touch-180.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 })) {
  await fs.copyFile(path.join(web, `${size}x${size}.png`), path.join(root, 'public/icons', name));
}
// A maskable PWA icon needs an opaque full-bleed background. The complete
// approved artwork remains intact, inset to keep the emblem in the safe area.
const artwork = (await fs.readFile(source)).toString('base64');
const maskable = path.join(staging, 'maskable.svg');
await fs.writeFile(maskable, `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#103D36"/><image x="40.96" y="40.96" width="430.08" height="430.08" href="data:image/png;base64,${artwork}"/></svg>`);
convert(maskable, path.join(staging, 'maskable'), [512]);
await fs.copyFile(path.join(staging, 'maskable/512x512.png'), path.join(root, 'public/icons/maskable-512.png'));
const favicon = (await fs.readFile(path.join(web, '64x64.png'))).toString('base64');
await fs.writeFile(path.join(root, 'public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${favicon}"/></svg>\n`);
console.log('Updated Windows, Store, browser and PWA icons from the approved shiori artwork.');
