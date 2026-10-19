// Tiny static file server for previewing the site locally.
// Run with `npm start`, then open http://localhost:8000
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const PORT = Number(process.env.PORT) || 8000;
const ROOT = resolve(import.meta.dirname ?? process.cwd());

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file = normalize(join(ROOT, urlPath));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store', // always serve your latest edits
    });
    res.end(body);
    console.log(`200 ${req.method} ${urlPath}`);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    console.log(`404 ${req.method} ${req.url}`);
  }
});

server.listen(PORT, () => {
  console.log(`MTG Master Sets running at http://localhost:${PORT}  (Ctrl+C to stop)`);
});
