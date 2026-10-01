import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

// Local static preview of dist-site/ (development only; GitHub Pages serves the same files).
const root = resolve(process.argv[2] ?? process.env.SITE_DIR ?? 'dist-site');
const port = Number(process.env.PORT ?? 4173);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.bin': 'application/octet-stream'
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  if (url.pathname.endsWith('/')) path = resolve(path, 'index.html');
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
