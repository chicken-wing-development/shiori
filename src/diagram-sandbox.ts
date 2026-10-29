import runtime, { hash } from 'virtual:diagram-runtime';
import type { Theme } from './types';

let frame: HTMLIFrameElement | undefined;
let port: MessagePort | undefined;
let ready: Promise<void> | undefined;
let urls: string[] = [];

function reset(): void {
  port?.close(); frame?.remove(); urls.forEach(url => URL.revokeObjectURL(url));
  port = undefined; frame = undefined; ready = undefined; urls = [];
}

function connect(): Promise<void> {
  return ready ??= new Promise<void>((resolve, reject) => {
    // Explicitly deny every resource class except our bundled script and inline CSS.
    const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><body><script>${runtime}</script></body>`;
    const src = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    urls = [src];
    frame = document.createElement('iframe');
    frame.title = 'Mermaid renderer'; frame.setAttribute('aria-hidden', 'true');
    frame.sandbox.add('allow-scripts'); // Deliberately omit allow-same-origin.
    frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:900px;height:1000px;pointer-events:none;border:0';
    const channel = new MessageChannel(); port = channel.port1;
    const timer = setTimeout(() => { reset(); reject(new Error('図の描画環境を起動できませんでした。')); }, 15_000);
    port.onmessage = event => { if (event.data?.ready === true) { clearTimeout(timer); resolve(); } };
    frame.onload = () => frame?.contentWindow?.postMessage('shiori-diagram-connect', '*', [channel.port2]);
    frame.src = src; document.body.append(frame);
  });
}

export async function renderInSandbox(id: number, source: string, theme: Theme): Promise<string> {
  await connect();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reset(); reject(new Error('図の描画が時間内に完了しませんでした。')); }, 15_000);
    port!.onmessage = ({ data }) => {
      if (data?.id !== id) return;
      clearTimeout(timer);
      if (typeof data.svg === 'string' && data.svg.length <= 10 * 1024 * 1024) resolve(data.svg);
      else reject(new Error(typeof data.error === 'string' ? data.error : '図が大きすぎるか、出力が不正です。'));
    };
    port!.postMessage({ id, source, theme });
  });
}
