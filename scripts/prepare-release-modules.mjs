import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const releaseRoot = path.join(root, 'releases');
const destination = path.join(releaseRoot, `.modules-hoisted-${process.platform}-${process.arch}`);
const pnpmCli = [process.env.npm_execpath, process.env.SITES_PNPM_BIN].find(value => value && /pnpm\.(?:c?js|mjs|exe)$/i.test(value));
if (!pnpmCli) throw new Error('Run "pnpm release" so the installed pnpm CLI is available.');
await fs.mkdir(destination, { recursive: true });
for (const file of ['package.json', 'pnpm-lock.yaml']) await fs.copyFile(path.join(root, file), path.join(destination, file));
await fs.cp(path.join(root, 'patches'), path.join(destination, 'patches'), { recursive: true });
const workspace = (await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).replace(/^(?:nodeLinker|extendNodePath):[^\n]*\n?/gm, '');
await fs.writeFile(path.join(destination, 'pnpm-workspace.yaml'), `${workspace.trimEnd()}\n\nnodeLinker: hoisted\nextendNodePath: false\n`);
let storeDir;
try {
  const state = JSON.parse(await fs.readFile(path.join(root, 'node_modules/.modules.yaml'), 'utf8'));
  if (state.storeDir) storeDir = /^v\d+$/.test(path.basename(state.storeDir)) ? path.dirname(state.storeDir) : state.storeDir;
} catch { /* pnpm can use its configured store. */ }
const args = ['--dir', destination, 'install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline', '--reporter', 'append-only'];
if (storeDir) args.push('--store-dir', storeDir);
const command = pnpmCli.endsWith('.exe') ? pnpmCli : process.execPath;
const result = spawnSync(command, command === process.execPath ? [pnpmCli, ...args] : args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const entries = await fs.readdir(path.join(destination, 'node_modules'), { recursive: true, withFileTypes: true });
if (entries.some(entry => entry.isSymbolicLink())) throw new Error('The distribution modules must not contain symlinks or junctions.');
await fs.writeFile(path.join(releaseRoot, '.module-source.json'), JSON.stringify({ directory: destination, platform: process.platform, arch: process.arch }, null, 2));
console.log(`Prepared ${entries.filter(entry => entry.isFile()).length} relocatable module files (${process.platform}/${process.arch}).`);
