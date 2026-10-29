import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [target, output] = process.argv.slice(2);
if (!target || !output) throw new Error('Usage: node scripts/rust-licenses.mjs <target-triple> <output>');
const result = spawnSync('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1', '--locked', '--filter-platform', target], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'cargo metadata failed');
const metadata = JSON.parse(result.stdout);
const supplements = JSON.parse(await fs.readFile('store/licenses/supplements.json', 'utf8'));
const included = new Set(metadata.resolve.nodes.map(node => node.id));
const packages = metadata.packages.filter(pkg => pkg.source && included.has(pkg.id)).sort((a, b) => a.name.localeCompare(b.name));
const sections = ['shiori: Rust dependency license notices\nIncludes runtime and build dependencies for ' + target + '.'];
for (const pkg of packages) {
  const directory = path.dirname(pkg.manifest_path);
  const files = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE)(?:$|[._-])/i.test(entry.name)).map(entry => path.join(directory, entry.name));
  if (pkg.license_file) files.push(path.resolve(directory, pkg.license_file));
  const texts = await Promise.all([...new Set(files)].map(async file => `${path.basename(file)}\n${await fs.readFile(file, 'utf8')}`));
  if (!texts.length) {
    const supplement = supplements[`${pkg.name}@${pkg.version}`];
    if (!supplement) throw new Error(`Missing license text for ${pkg.name}@${pkg.version}; add an upstream notice to store/licenses.`);
    texts.push(`License source: ${supplement.source}\n${await fs.readFile(path.join('store/licenses', supplement.file), 'utf8')}`);
  }
  let sourceNotice = `Source: https://crates.io/crates/${pkg.name}/${pkg.version}`;
  if (pkg.license?.includes('MPL-2.0')) {
    const archive = `${pkg.name}-${pkg.version}.crate`;
    const cached = path.resolve(directory, '../../../cache', path.basename(path.dirname(directory)), archive);
    const destination = path.join(path.dirname(output), 'third-party-sources');
    await fs.mkdir(destination, { recursive: true });
    await fs.copyFile(cached, path.join(destination, archive));
    sourceNotice += `\nUnmodified source archive included: third-party-sources/${archive}`;
  }
  sections.push(`${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? 'see license file'}\n${pkg.repository ?? ''}\n${sourceNotice}\n\n${texts.join('\n\n')}`);
}
await fs.writeFile(output, sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
console.log(`Rust license notices: ${packages.length} packages`);
