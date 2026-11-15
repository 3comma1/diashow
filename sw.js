/**
 * sw.js — Service Worker für NeonMosaik
 * ===========================================================================
 * Ziel: Nach dem ersten Besuch läuft die App **vollständig offline** —
 * inklusive aller Fotos.
 *
 * Strategien
 *   App-Shell (HTML, CSS, JS, Icons)  → Cache-First, versioniert
 *   Navigationen                      → Cache-First, Fallback: Netz/Offline-Seite
 *   Unsplash-Bilder                   → Cache-First (unbegrenzt lange gültig)
 *   Unsplash-API                      → wird nie gecacht (enthält den Key)
 *   Alles andere (fremde Hosts)       → unangetastet
 *
 * Wichtig für die Entwicklung:
 *   Nach Änderungen an index.html, styles.css, app.js oder photos.js muss
 *   VERSION erhöht werden — der neue Service Worker installiert dann einen
 *   frischen, in sich stimmigen Satz aller Shell-Dateien.
 *
 * Zusätzlich: Auf Anfrage der App werden ganze Bilderpools im Voraus
 * gespeichert (PRECACHE_IMAGES) — so ist die Galerie auch ohne Netz komplett.
 * ===========================================================================
 */

const VERSION = 'v1.0.0';
const SHELL_CACHE = `neonmosaik-shell-${VERSION}`;
const IMAGE_CACHE = `neonmosaik-images-${VERSION}`;

/** Obergrenze für den Bilder-Cache (FIFO, älteste zuerst). */
const MAX_IMAGES = 256;
/** Parallele Downloads beim Vorladen. */
const MAX_PARALLEL = 4;
/** Timeout für Navigationsanfragen, danach kommt der Cache zum Zug. */
const NAV_TIMEOUT = 4000;

/** Basis-URL = Ablageort des Service Workers (unterstützt Unterordner). */
const BASE = new URL('./', self.location.href);
const abs = (path) => new URL(path, BASE).href;

/** Dateien, die die App zum Starten braucht. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './photos.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
].map(abs);

/* ===========================================================================
   Installation & Aktivierung
   =========================================================================== */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Einzeln hinzufügen: eine fehlende Datei darf nicht alles blockieren.
    await Promise.allSettled(
      SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Alte Versionen aufräumen.
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== SHELL_CACHE && key !== IMAGE_CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
    await broadcast({ type: 'SW_ACTIVE', version: VERSION });
  })());
});

/* ===========================================================================
   Fetch-Strategien
   =========================================================================== */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Kein Caching von API-Antworten (der Access Key steckt in der URL).
  if (url.hostname === 'api.unsplash.com') return;

  // Fotos vom Unsplash-CDN: Cache-First.
  if (url.hostname === 'images.unsplash.com') {
    event.respondWith(handleImage(request));
    return;
  }

  // Fremde Hosts nicht anfassen.
  if (url.origin !== self.location.origin) return;

  // Seitenaufrufe: erst Netz, sonst Cache.
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // App-Shell: aus dem Cache antworten und parallel aktualisieren.
  event.respondWith(handleAsset(request));
});

/** Bilder: sofort aus dem Cache, sonst laden und ablegen. */
async function handleImage(request) {
  const cache = await caches.open(IMAGE_CACHE);

  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  try {
    const response = await fetch(request, { mode: 'cors', credentials: 'omit' });
    if (response.ok) {
      await cache.put(request, response.clone());
      trimCache(IMAGE_CACHE, MAX_IMAGES);
    }
    return response;
  } catch {
    // Offline und nicht im Cache → hübsche Neon-Kachel statt kaputtem Bild.
    return placeholderResponse();
  }
}

/** Navigationen: aus dem Cache, sonst Netz. */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  // Die Shell wird bei jeder neuen SW-Version frisch vorinstalliert —
  // deshalb ist Cache-First hier sicher und liefert sofortigen Start.
  const cached = await cache.match(abs('./index.html'), { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(request, NAV_TIMEOUT);
    if (response && response.ok) {
      cache.put(abs('./index.html'), response.clone());
    }
    return response;
  } catch {
    return offlineDocument();
  }
}

/** App-Shell-Dateien (CSS, JS, Icons): Cache-First. */
async function handleAsset(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('/* offline */', {
      status: 504,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/* ===========================================================================
   Hilfsfunktionen
   =========================================================================== */

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Entfernt die ältesten Einträge, wenn der Cache zu groß wird (FIFO). */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

/** Neon-Platzhalter für Bilder, die offline nicht vorliegen. */
function placeholderResponse() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1024"/>
      <stop offset="1" stop-color="#160a2c"/>
    </linearGradient>
  </defs>
  <rect width="320" height="320" fill="url(#g)"/>
  <g fill="none" stroke-width="2" opacity="0.55">
    <rect x="18" y="18" width="120" height="120" rx="16" stroke="#00f0ff"/>
    <rect x="150" y="18" width="152" height="72" rx="16" stroke="#ff2bd6"/>
    <rect x="150" y="102" width="72" height="200" rx="16" stroke="#a86bff"/>
    <rect x="234" y="102" width="68" height="98" rx="16" stroke="#b6ff2b"/>
    <rect x="18" y="150" width="120" height="152" rx="16" stroke="#00f0ff"/>
    <rect x="234" y="212" width="68" height="90" rx="16" stroke="#ffb02b"/>
  </g>
  <text x="160" y="172" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="15" letter-spacing="3" fill="#7f8db0">OFFLINE</text>
</svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-NeonMosaik-Fallback': '1',
    },
  });
}

/** Letzter Ausweg, falls nicht einmal die Shell im Cache liegt. */
function offlineDocument() {
  return new Response(
    `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — NeonMosaik</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;
font-family:Helvetica,Arial,sans-serif;background:#05060a;color:#eef4ff;text-align:center;padding:24px}
h1{color:#00f0ff;text-shadow:0 0 18px #00f0ff;letter-spacing:.08em}
p{color:#7f8db0;max-width:32ch;line-height:1.6}</style></head>
<body><div><h1>NOCH NICHT OFFLINE-BEREIT</h1>
<p>Diese Seite wurde noch nicht zwischengespeichert. Bitte einmal mit Internet öffnen — danach funktioniert NeonMosaik vollständig offline.</p>
</div></body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/* ===========================================================================
   Nachrichten von der App
   =========================================================================== */

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const source = event.source || null;

  switch (data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_CACHES':
      event.waitUntil((async () => {
        await Promise.all([caches.delete(SHELL_CACHE), caches.delete(IMAGE_CACHE)]);
        await broadcast({ type: 'CACHES_CLEARED' });
      })());
      break;

    case 'STATUS':
      event.waitUntil(reportStatus(source));
      break;

    case 'PRECACHE_IMAGES':
      event.waitUntil(precacheImages(data.urls || [], source));
      break;

    default:
      break;
  }
});

/** Lädt einen Bilderpool vor und meldet den Fortschritt an die App. */
async function precacheImages(urls, source) {
  const cache = await caches.open(IMAGE_CACHE);
  const total = urls.length;
  let done = 0;
  const queue = [];

  for (const url of urls) {
    if (await cache.match(url, { ignoreVary: true })) done++;
    else queue.push(url);
  }

  await post({ type: 'PRECACHE_PROGRESS', done, total }, source);

  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const response = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
        if (response.ok) await cache.put(url, response.clone());
      } catch {
        // Offline oder Netzfehler: beim nächsten Vorladen erneut versuchen.
      }
      done++;
      await post({ type: 'PRECACHE_PROGRESS', done, total }, source);
    }
  };

  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));
  await trimCache(IMAGE_CACHE, MAX_IMAGES);
  await post({ type: 'PRECACHE_DONE', done, total }, source);
}

async function reportStatus(source) {
  const [shell, images] = await Promise.all([
    caches.open(SHELL_CACHE).then((c) => c.keys()),
    caches.open(IMAGE_CACHE).then((c) => c.keys()),
  ]);
  await post(
    {
      type: 'STATUS',
      version: VERSION,
      shellCount: shell.length,
      imageCount: images.length,
    },
    source,
  );
}

/* ===========================================================================
   Kommunikation
   =========================================================================== */

function post(message, source) {
  if (source && typeof source.postMessage === 'function') {
    source.postMessage(message);
    return Promise.resolve();
  }
  return broadcast(message);
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((client) => client.postMessage(message));
}
