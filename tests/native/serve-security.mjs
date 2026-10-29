import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('test-results/export-security-fix/native');
await mkdir(output, { recursive: true });
let received = 0;
const trap = createServer((req, res) => {
  received++;
  void writeFile(path.join(output, 'network.json'), JSON.stringify({ received, last: req.url }));
  res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }); res.end('trap');
});
await new Promise(resolve => trap.listen(4188, '127.0.0.1', resolve));
await writeFile(path.join(output, 'network.json'), JSON.stringify({ received }));
const server = await createViteServer({ mode: 'desktop', server: { host: '127.0.0.1', port: 1420, strictPort: true }, plugins: [{ name: 'native-security-reporter', configureServer(server) {
  server.middlewares.use('/__security-results', async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 100_000) { res.writeHead(413).end(); return; } }
    const report = JSON.parse(text); await writeFile(path.join(output, 'webview2-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.results.at(-1))); res.writeHead(204).end();
  });
} }] });
await server.listen(); console.log('Native security fixture: http://127.0.0.1:1420/tests/native-security.html');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { trap.close(); await server.close(); process.exit(); });
