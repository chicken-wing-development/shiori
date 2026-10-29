import mermaid from 'mermaid';

// This module runs only inside the sandbox. No IPC, storage, or network access.
window.addEventListener('message', function connect(event: MessageEvent) {
  if (event.source !== parent || event.data !== 'shiori-diagram-connect' || event.ports.length !== 1) return;
  window.removeEventListener('message', connect);
  const port = event.ports[0];
  port.onmessage = async ({ data }) => {
    const { id, source, theme } = data ?? {};
    try {
      if (!Number.isSafeInteger(id) || typeof source !== 'string' || source.length > 50_000 || !['light', 'dark'].includes(theme)) throw new Error('図の入力が不正です。');
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
        maxTextSize: 50_000, maxEdges: 500, htmlLabels: false, theme: 'base',
        fontFamily: '"Yu Gothic UI", "Hiragino Kaku Gothic ProN", sans-serif',
        themeVariables: theme === 'dark'
          ? { primaryColor: '#25483f', primaryTextColor: '#e3e9e2', primaryBorderColor: '#709e8b', lineColor: '#90ae9f', secondaryColor: '#303d38', tertiaryColor: '#252e2a', background: '#1c231f', mainBkg: '#25483f', nodeBorder: '#709e8b', textColor: '#e3e9e2' }
          : { primaryColor: '#edf3ee', primaryTextColor: '#274c40', primaryBorderColor: '#85a696', lineColor: '#77988a', secondaryColor: '#f6f2e9', tertiaryColor: '#f4f5ef', background: '#fbfcf9', mainBkg: '#edf3ee', nodeBorder: '#85a696', textColor: '#274c40' },
        secure: ['securityLevel', 'startOnLoad', 'secure', 'maxTextSize', 'maxEdges', 'themeCSS', 'fontFamily', 'htmlLabels'],
      });
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
      // Image nodes cannot be exported safely; reject before their renderer loads an image.
      const db = diagram.db as { getVertices?: () => Map<string, { img?: unknown }> };
      if (db.getVertices && [...db.getVertices().values()].some(node => node.img)) throw new Error('Mermaid内の画像には対応していません。画像はMarkdownで挿入してください。');
      const { svg } = await mermaid.render(`shiori-diagram-${id}`, source);
      port.postMessage({ id, svg });
    } catch (error) {
      port.postMessage({ id, error: error instanceof Error ? error.message.slice(0, 600) : '図を描画できませんでした。' });
    }
  };
  port.postMessage({ ready: true });
});
