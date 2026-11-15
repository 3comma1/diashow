/**
 * server.mjs — minimaler statischer Webserver für die lokale Entwicklung.
 * ---------------------------------------------------------------------------
 * Service Worker (und damit die Offline-Funktion) laufen nur über http(s),
 * nicht über file://. Deshalb diesen Server starten:
 *
 *     npm start          → http://localhost:8080
 *     PORT=3000 npm start
 *
 * Es werden keine Abhängigkeiten benötigt (reines Node.js).
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

    // Pfad-Ausbrüche verhindern.
    const target = resolve(join(ROOT, pathname));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      return send(res, 403, 'Forbidden');
    }

    let filePath = target;
    if (pathname.endsWith('/')) filePath = join(target, 'index.html');

    let body;
    try {
      body = await readFile(filePath);
    } catch {
      // Ohne Endung: als HTML versuchen, sonst 404.
      if (!extname(filePath)) {
        try {
          body = await readFile(join(ROOT, 'index.html'));
          filePath = join(ROOT, 'index.html');
        } catch {
          return send(res, 404, 'Not found');
        }
      } else {
        return send(res, 404, 'Not found');
      }
    }

    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const extra = {};
    if (filePath.endsWith('sw.js')) extra['Service-Worker-Allowed'] = '/';
    send(res, 200, body, { 'Content-Type': type, ...extra });
  } catch (error) {
    send(res, 500, `Serverfehler: ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  NeonMosaik läuft auf http://localhost:${PORT}\n`);
  console.log('  Beenden mit Strg + C\n');
});
