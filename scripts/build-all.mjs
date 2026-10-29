import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const tests = (await fs.readdir(path.join(root, 'tests'))).filter(file => file.endsWith('.test.ts')).sort();
run(['--experimental-strip-types', '--test', ...tests.map(file => `tests/${file}`)]);
run(['node_modules/typescript/bin/tsc', '--noEmit']);
run(['node_modules/vite/bin/vite.js', 'build']);
run(['--experimental-strip-types', 'scripts/build-portable.mjs']);
if (process.argv.includes('--release')) {
  await fs.mkdir(path.join(root, 'releases'), { recursive: true });
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  await fs.writeFile(path.join(root, 'releases/.build-report.json'), JSON.stringify({ version, node: process.version, checkedAt: new Date().toISOString(), testFiles: tests, tests: 'passed', typecheck: 'passed', pwaBuild: 'passed', htmlBuild: 'passed' }, null, 2));
  run(['scripts/prepare-release-modules.mjs']);
  run(['scripts/package-release.mjs']);
}
