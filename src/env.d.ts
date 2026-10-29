/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'markdown-it-task-lists' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
declare module 'virtual:diagram-runtime' { const code: string; export const hash: string; export default code; }
