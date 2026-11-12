// Local server for the bug demo with recorder "gdigrab" (ego-browser cannot use Playwright routes).
// Serves app/index.html at http://127.0.0.1:4310/ and fails POST /api/passengers slowly.
// Usage: node examples/bug-demo/server.mjs   (PORT=5000 to change the port)

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number(process.env.PORT ?? 4310);
const html = readFileSync(new URL('./app/index.html', import.meta.url));

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/passengers' && req.method === 'POST') {
    req.resume();
    setTimeout(() => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"name too long"}');
    }, 8000);
    return;
  }
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => console.log(`bug-demo: http://127.0.0.1:${port}/`));
