import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { diagramPlugin } from './scripts/diagram-plugin.ts';

export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
  base: desktop ? './' : '/',
  clearScreen: false,
  optimizeDeps: { entries: ['index.html', 'tests/*.html'] },
  server: { host: '127.0.0.1', port: desktop ? 1420 : 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  plugins: [
    diagramPlugin(),
    desktop ? {
      name: 'desktop-shell',
      resolveId(id: string) { if (id === 'virtual:pwa-register') return '\0desktop-pwa'; },
      load(id: string) { if (id === '\0desktop-pwa') return 'export const registerSW = () => async () => {};'; },
      // Tauri injects its IPC-aware CSP from tauri.conf.json.
      transformIndexHtml(html: string) { return html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/i, ''); },
    } : VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'shiori markdown editor',
        short_name: 'shiori',
        description: 'MarkdownとMermaidを、このデバイスで。',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#faf9f6',
        theme_color: '#faf9f6',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  build: { outDir: desktop ? 'dist-desktop' : 'dist', target: 'es2022', chunkSizeWarningLimit: 1800, license: { fileName: 'THIRD-PARTY-LICENSES.md' } },
  };
});
