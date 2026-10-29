import { build, type Plugin } from 'vite';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Bundle a self-contained renderer for an opaque-origin, network-denied frame. */
export function diagramPlugin(): Plugin {
  let root = process.cwd();
  let runtime: Promise<{ code: string; hash: string; notices: string }> | undefined;
  const compile = () => runtime ??= (async () => {
    const result = await build({
      configFile: false, root, publicDir: false, logLevel: 'error',
      build: {
        write: false, target: 'es2022', minify: true,
        lib: { entry: path.join(root, 'src/diagram-renderer.ts'), name: 'ShioriDiagramRenderer', formats: ['iife'] },
        rolldownOptions: { output: { codeSplitting: false } },
        license: { fileName: 'DIAGRAM-LICENSES.md' },
      },
    });
    if (!Array.isArray(result) && !('output' in result)) throw new Error('Unexpected renderer watch build');
    const output = Array.isArray(result) ? result.flatMap(value => value.output) : result.output;
    const scripts = output.filter(value => value.type === 'chunk');
    if (scripts.length !== 1 || scripts[0].imports.length || scripts[0].dynamicImports.some(file => file !== scripts[0].fileName)) throw new Error('Diagram renderer must be self-contained');
    const notices = output.find(value => value.type === 'asset' && value.fileName === 'DIAGRAM-LICENSES.md');
    if (!notices || notices.type !== 'asset') throw new Error('Diagram license notices missing');
    const code = scripts[0].code.replace(/\r\n/g, '\n').replace(/<\/script/gi, '<\\/script');
    return { code, hash: createHash('sha256').update(code).digest('base64'), notices: String(notices.source) };
  })();
  return {
    name: 'isolated-diagram-renderer',
    configResolved(config) { root = config.root; },
    resolveId(id) { if (id === 'virtual:diagram-runtime') return '\0diagram-runtime'; },
    async load(id) {
      if (id !== '\0diagram-runtime') return;
      this.addWatchFile(path.join(root, 'src/diagram-renderer.ts'));
      const result = await compile();
      return `export default ${JSON.stringify(result.code)}; export const hash = ${JSON.stringify(result.hash)};`;
    },
    watchChange(id) { if (id.endsWith('/diagram-renderer.ts')) runtime = undefined; },
    async transformIndexHtml(html) { return html.replace("script-src 'self'", `script-src 'self' 'sha256-${(await compile()).hash}'`); },
    async generateBundle() {
      const result = await compile();
      this.emitFile({ type: 'asset', fileName: 'DIAGRAM-LICENSES.md', source: result.notices });
      // Tauri adds the hash of every embedded JS asset to its CSP automatically.
      this.emitFile({ type: 'asset', fileName: 'diagram-runtime.js', source: result.code });
    },
  };
}
