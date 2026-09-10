// Local dev server: static files + /api/* dispatch to the same serverless
// handlers Vercel runs in production. Zero dependencies.
// Usage: node tools/dev-server.js [port]

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8765;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------------
// Minimal Vercel request/response emulation
// ---------------------------------------------------------------------------
function polyfillReqRes(req, res, body) {
  req.body = body;
  const url = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(url.searchParams);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
  });
}

async function handleApi(req, res, urlPath) {
  // /api/accounts → api/accounts.js ; /api/cron/purge-photos → api/cron/purge-photos.js
  const rel = urlPath.replace(/^\/api\//, '');
  const handlerPath = path.join(root, 'api', `${rel}.js`);
  try {
    const mod = await import(pathToFileURL(handlerPath).href);
    const body = await readBody(req);
    polyfillReqRes(req, res, body);
    await mod.default(req, res);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    } else {
      console.error(`API error on ${urlPath}:`, err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal' }));
    }
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (urlPath.startsWith('/api/')) {
    return handleApi(req, res, urlPath);
  }

  try {
    let filePath = urlPath === '/' ? '/index.html' : urlPath;
    const file = path.join(root, filePath);
    if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
