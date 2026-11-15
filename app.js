/**
 * app.js — NeonMosaik
 * ===========================================================================
 * Eine installierbare Progressive Web App, die ein lebendiges Mosaik aus
 * zufälligen Unsplash-Fotos zeigt.
 *
 * Aufbau dieses Moduls
 *   01  Konstanten & Hilfsfunktionen
 *   02  Zustand (State) & Persistenz
 *   03  Mosaik-Geometrie (Packing, Grid-Berechnung)
 *   04  Kacheln erzeugen & Bilder wechseln
 *   05  Bilderquellen (kuratiert / Unsplash-API)
 *   06  Rotation
 *   07  Offline-Strategie & Service Worker
 *   08  Benutzeroberfläche (Controls, Optionen, Toasts)
 *   09  Start
 * ===========================================================================
 */

import {
  CURATED_PHOTO_IDS,
  NEON_PALETTE,
  UNSPLASH,
  imageUrl,
  tuneRawUrl,
} from './photos.js';

/* ===========================================================================
   01  Konstanten & Hilfsfunktionen
   =========================================================================== */

/** Wechsel-Tempo: Slider-Stufe → Zeitfenster, Kacheln pro Takt. */
const SPEEDS = [
  { key: 'ruhig',     min: 7000, max: 13000, batch: 1 },
  { key: 'gemütlich', min: 4200, max: 8000,  batch: 1 },
  { key: 'normal',    min: 2200, max: 5000,  batch: 1 },
  { key: 'flott',     min: 1100, max: 2600,  batch: 2 },
  { key: 'hektisch',  min: 550,  max: 1500,  batch: 3 },
];

const STORAGE_KEY = 'neonmosaik.settings.v1';
const API_CACHE_KEY = 'neonmosaik.apiCache.v1';

const DEFAULT_SETTINGS = {
  speed: 2,
  motion: true,
  credits: false,
  warm: true,
  apiKey: '',
};

/** Bildwechsel-Dauer in ms — muss zu --fade in styles.css passen. */
const FADE_MS = 900;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** Mischt ein Array (Fisher-Yates), ohne das Original zu verändern. */
function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const debounce = (fn, wait) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ===========================================================================
   02  Zustand & Persistenz
   =========================================================================== */

const state = {
  settings: { ...DEFAULT_SETTINGS },
  /** Aktuell im Mosaik sichtbare Foto-Objekte, Index = Kachel-Index. */
  tilePhotos: [],
  /** DOM-Kacheln: { el, layers, active, photo } */
  tiles: [],
  /** Pool der Foto-Objekte, aus dem gewechselt wird. */
  pool: [],
  /** 'curated' | 'api' */
  mode: 'curated',
  cols: 0,
  rows: 0,
  paused: false,
  reducedMotion: false,
  lite: false,
  timer: null,
  warmController: null,
  installEvent: null,
  swReady: null,
};

const settings = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch { /* localStorage kann blockiert sein — dann eben Standardwerte */ }
    state.settings.speed = clamp(Number(state.settings.speed) || 0, 0, SPEEDS.length - 1);
  },
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch { /* ignorieren */ }
  },
};

const apiCache = {
  read() {
    try { return JSON.parse(localStorage.getItem(API_CACHE_KEY) || 'null'); }
    catch { return null; }
  },
  write(list) {
    try { localStorage.setItem(API_CACHE_KEY, JSON.stringify(list.slice(0, 60))); }
    catch { /* ignorieren */ }
  },
};

/* ===========================================================================
   03  Mosaik-Geometrie
   =========================================================================== */

/**
 * Zerlegt ein Raster vollständig und lückenlos in rechteckige Kacheln.
 * Jede Kachel passt garantiert ins Raster — es entstehen weder Löcher noch
 * Überläufe. Das Ergebnis ist damit ein echtes Mosaik.
 *
 * @param {number} cols
 * @param {number} rows
 * @returns {Array<{r:number,c:number,rs:number,cs:number}>}
 */
function packMosaic(cols, rows) {
  const occ = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const tiles = [];

  // Formen mit Gewichtung: viele kleine Steine, dazwischen Eyecatcher.
  const SHAPES = [
    { rs: 1, cs: 1, weight: 42 },
    { rs: 2, cs: 1, weight: 21 },
    { rs: 1, cs: 2, weight: 21 },
    { rs: 2, cs: 2, weight: 16 },
  ];

  const fits = (r, c, rs, cs) => {
    if (r + rs > rows || c + cs > cols) return false;
    for (let i = 0; i < rs; i++) {
      for (let j = 0; j < cs; j++) if (occ[r + i][c + j]) return false;
    }
    return true;
  };

  const mark = (r, c, rs, cs, value) => {
    for (let i = 0; i < rs; i++) {
      for (let j = 0; j < cs; j++) occ[r + i][c + j] = value;
    }
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (occ[r][c]) continue;

      const options = SHAPES.filter((s) => fits(r, c, s.rs, s.cs));
      const total = options.reduce((sum, s) => sum + s.weight, 0);
      let roll = Math.random() * total;
      let chosen = options[options.length - 1];
      for (const s of options) {
        roll -= s.weight;
        if (roll <= 0) { chosen = s; break; }
      }

      mark(r, c, chosen.rs, chosen.cs, true);
      tiles.push({ r, c, rs: chosen.rs, cs: chosen.cs });
    }
  }

  return tiles;
}

/**
 * Ermittelt Spalten- und Zeilenzahl so, dass die Kacheln möglichst
 * quadratisch bleiben und die Fläche vollständig gefüllt wird.
 */
function computeGrid(width, height, gap) {
  const phone = width < 560;
  const target = phone ? 112 : width < 900 ? 158 : width < 1300 ? 196 : width < 1800 ? 228 : 258;

  let cols = Math.round((width + gap) / (target + gap));
  cols = clamp(cols, phone ? 3 : 4, 9);

  const cell = (width - (cols - 1) * gap) / cols;
  let rows = Math.round((height + gap) / (cell + gap));
  rows = clamp(rows, 3, 9);

  return { cols, rows, cell };
}

/* ===========================================================================
   04  Kacheln erzeugen & Bilder wechseln
   =========================================================================== */

/**
 * Legt die zwei Bildebenen einer Kachel an. Zwei Ebenen erlauben eine
 * weiche Überblendung: das neue Foto lädt unsichtbar im Hintergrund und
 * wird erst nach dem Laden eingeblendet.
 */
function createTileElement(spec, index) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.style.gridArea = `${spec.r + 1} / ${spec.c + 1} / span ${spec.rs} / span ${spec.cs}`;
  el.style.setProperty('--glow', pick(NEON_PALETTE));
  el.style.setProperty('--kb', `${Math.round(rand(26, 42))}s`);
  // Negativer Startwert → jede Kachel beginnt in einer anderen Zoom-Phase.
  el.style.setProperty('--kb-delay', `-${Math.round(rand(0, 26000))}ms`);

  const layers = [0, 1].map(() => {
    const img = document.createElement('img');
    img.className = 'tile__img';
    img.alt = '';
    img.decoding = 'async';
    img.loading = index < 8 ? 'eager' : 'lazy';
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer-when-downgrade';
    img.draggable = false;
    el.append(img);
    return img;
  });

  const credit = document.createElement('a');
  credit.className = 'tile__credit';
  credit.target = '_blank';
  credit.rel = 'noopener noreferrer';
  credit.hidden = true;
  credit.append(document.createElement('span'));
  el.append(credit);

  return { el, layers, active: 0, photo: null, credit, pending: false };
}

/** Aktualisiert das Urheber-Label einer Kachel. */
function applyCredit(tile, photo) {
  const credit = tile.credit;
  const info = photo?.credit;

  if (!info || !state.settings.credits) {
    credit.hidden = true;
    return;
  }

  credit.hidden = false;
  credit.href = info.href;
  credit.title = info.title || `Foto: ${info.name}`;
  credit.querySelector('span').textContent = `© ${info.name}`;
}

/**
 * Blendet in einer Kachel ein neues Foto ein.
 * Das aktuelle Bild bleibt sichtbar, bis das neue vollständig geladen ist.
 */
function setTilePhoto(tile, photo) {
  // Läuft für diese Kachel schon ein Wechsel, wird sie diesmal übersprungen.
  if (tile.pending) return;

  const incoming = tile.layers[1 - tile.active];
  const outgoing = tile.layers[tile.active];
  const url = photo.src;

  tile.pending = true;
  let settled = false;

  const commit = () => {
    if (settled) return;
    settled = true;
    tile.pending = false;
    // Ein Frame Pause, damit die CSS-Transition sicher greift.
    requestAnimationFrame(() => {
      incoming.classList.add('is-active');
      outgoing.classList.remove('is-active');
      tile.active = 1 - tile.active;
      tile.el.classList.remove('tile--error');
    });
  };

  const fail = () => {
    if (settled) return;
    settled = true;
    tile.pending = false;
    tile.el.classList.add('tile--error');
    // Kein Bild verfügbar (z. B. offline und nicht im Cache) → nächstes Mal neu.
    console.warn('[NeonMosaik] Bild nicht ladbar:', url);
  };

  incoming.addEventListener('load', commit, { once: true });
  incoming.addEventListener('error', fail, { once: true });

  incoming.src = url;
  tile.photo = photo;
  applyCredit(tile, photo);

  // Falls das Bild schon im Speicher liegt, greift `complete` sofort.
  if (incoming.complete && incoming.naturalWidth > 0) commit();

  // Sicherheitsnetz: niemals ewig warten.
  setTimeout(() => {
    if (!settled) {
      if (incoming.naturalWidth > 0) commit();
      else fail();
    }
  }, FADE_MS + 6000);
}

/** Baut das komplette Mosaik neu auf (bei Start und bei Größenänderung). */
function buildMosaic({ animate = false } = {}) {
  const mosaic = $('#mosaic');
  const gap = parseFloat(getComputedStyle(mosaic).columnGap) || 8;
  const width = mosaic.clientWidth;
  const height = mosaic.clientHeight;
  if (width < 40 || height < 40) return;

  const { cols, rows } = computeGrid(width, height, gap);
  if (cols === state.cols && rows === state.rows && !animate) return;

  state.cols = cols;
  state.rows = rows;
  mosaic.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  mosaic.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  const specs = packMosaic(cols, rows);
  const previous = state.tilePhotos.slice();
  const previousTiles = state.tiles;

  mosaic.replaceChildren();
  state.tiles = [];

  specs.forEach((spec, index) => {
    const tile = createTileElement(spec, index);
    const photo = previous[index] || nextPhoto();

    state.tilePhotos[index] = photo;
    state.tiles.push(tile);
    mosaic.append(tile.el);

    if (photo) setTilePhoto(tile, photo);
    if (animate) {
      tile.el.classList.add('is-fresh');
      setTimeout(() => tile.el.classList.remove('is-fresh'), 1100);
    }
  });

  // Alte Kacheln aufräumen (Bilder freigeben)
  previousTiles.forEach((t) => t.layers.forEach((img) => img.removeAttribute('src')));

  // Verwaiste Foto-Referenzen aus einer früheren, größeren Rasterung entfernen.
  state.tilePhotos.length = specs.length;

  mosaic.classList.add('is-ready');
  requestAnimationFrame(() => $('#skeleton')?.classList.add('is-gone'));
  setTimeout(() => $('#skeleton')?.setAttribute('hidden', ''), 700);
}

/* ===========================================================================
   05  Bilderquellen
   =========================================================================== */

/** Kuratierte Foto-Objekte aus dem festen Pool. */
function curatedPhotos() {
  return CURATED_PHOTO_IDS.map((id) => ({
    id,
    src: imageUrl(id),
    credit: {
      name: 'Unsplash',
      href: `${UNSPLASH.imageBase}${id}`,
      title: 'Foto von Unsplash — zur Bildquelle',
    },
  }));
}

/** Wandelt ein Unsplash-API-Objekt in ein internes Foto-Objekt um. */
function fromApiPhoto(photo) {
  return {
    id: photo.id,
    raw: photo.urls.raw,
    src: tuneRawUrl(photo.urls.raw),
    credit: {
      name: photo.user?.name || 'Unsplash',
      href: `${photo.user?.links?.html || UNSPLASH.home}${UNSPLASH.referral}`,
      title: `Foto von ${photo.user?.name || 'Unsplash'} auf Unsplash`,
    },
  };
}

/** Baut den aktuellen Bilderpool abhängig vom Modus auf. */
async function refreshPool({ force = false } = {}) {
  if (state.settings.apiKey) {
    state.mode = 'api';
    const list = await fetchApiPhotos(force);
    if (list.length) {
      state.pool = list;
      return;
    }
    // API nicht erreichbar → kuratierter Pool als Rückfallebene.
    state.mode = 'curated';
    showToast('Unsplash-API nicht erreichbar — nutze den lokalen Bilderpool.', 'warn');
  }
  state.pool = shuffle(curatedPhotos());
}

/** Holt Zufallsfotos über die offizielle Unsplash-API (nur mit Access Key). */
async function fetchApiPhotos(force) {
  const key = state.settings.apiKey;
  if (!key) return [];

  const cached = apiCache.read();
  const fresh = cached && Date.now() - cached.time < 1000 * 60 * 30;

  if (fresh && !force) {
    return cached.list.map((p) => ({ ...p, src: tuneRawUrl(p.raw) }));
  }

  const count = clamp(state.cols * state.rows + 12, 20, 30);
  const url = `${UNSPLASH.api}/photos/random?count=${count}&client_id=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const photos = (Array.isArray(data) ? data : [data]).map(fromApiPhoto);

    apiCache.write(photos.map((p) => ({ id: p.id, raw: p.raw, credit: p.credit })));
    return photos;
  } catch (err) {
    console.warn('[NeonMosaik] Unsplash-API:', err);
    if (cached?.list?.length) {
      // Offline oder Limit erreicht → gespeicherte Metadaten nutzen.
      return cached.list.map((p) => ({
        id: p.id,
        raw: p.raw,
        src: tuneRawUrl(p.raw),
        credit: p.credit,
      }));
    }
    return [];
  }
}

/** Liefert ein Foto, das möglichst noch nicht im Mosaik sichtbar ist. */
function nextPhoto() {
  const pool = state.pool;
  if (!pool.length) return null;

  const inUse = new Set(state.tiles.map((t) => t.photo?.id).filter(Boolean));
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate = pick(pool);
    if (!inUse.has(candidate.id)) return candidate;
  }
  return pick(pool);
}

/* ===========================================================================
   06  Rotation
   =========================================================================== */

function scheduleTick() {
  clearTimeout(state.timer);
  if (state.paused) return;

  const speed = SPEEDS[state.settings.speed];
  const delay = rand(speed.min, speed.max);

  state.timer = setTimeout(() => {
    tick(speed.batch);
    scheduleTick();
  }, delay);
}

/** Ersetzt ein bis drei zufällige Kacheln durch neue Fotos. */
function tick(batch) {
  if (!state.tiles.length || document.hidden) return;

  const indices = shuffle(state.tiles.map((_, i) => i)).slice(0, batch);
  indices.forEach((index, offset) => {
    const tile = state.tiles[index];
    if (!tile) return;
    // Kleine Verschiebung, damit nicht alles exakt gleichzeitig umspringt.
    setTimeout(() => {
      const photo = nextPhoto();
      if (!photo) return;
      state.tilePhotos[index] = photo;
      setTilePhoto(tile, photo);
    }, offset * 220);
  });
}

/** Alle Kacheln auf einmal neu bestücken. */
function reshuffleAll() {
  state.pool = shuffle(state.pool);
  state.tiles.forEach((tile, index) => {
    setTimeout(() => {
      const photo = nextPhoto();
      if (!photo) return;
      state.tilePhotos[index] = photo;
      setTilePhoto(tile, photo);
    }, index * 45);
  });
  showToast('Mosaik neu gemischt');
}

function setPaused(paused) {
  state.paused = paused;
  const btn = $('#btnPlay');
  btn.setAttribute('aria-pressed', String(!paused));
  $('#btnPlayIcon').textContent = paused ? '▶' : '❚❚';
  $('#btnPlayText').textContent = paused ? 'Start' : 'Pause';
  btn.title = paused ? 'Animation starten' : 'Animation pausieren';
  if (paused) clearTimeout(state.timer);
  else scheduleTick();
}

/* ===========================================================================
   07  Offline-Strategie & Service Worker
   =========================================================================== */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    $('#cacheInfo').textContent = 'Offline-Cache: nicht unterstützt';
    return;
  }
  if (location.protocol === 'file:') {
    showToast('Für Offline-Betrieb bitte über einen lokalen Server öffnen.', 'warn');
    return;
  }

  state.swReady = navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      // Auf ein Update prüfen, aber nicht bei jedem Aufruf neu laden.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Neue Version geladen — Seite neu starten für das Update.', 'warn');
          }
        });
      });
      return navigator.serviceWorker.ready;
    })
    .catch((err) => {
      console.warn('[NeonMosaik] Service Worker:', err);
      return null;
    });

  navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'PRECACHE_PROGRESS') {
      updateStorageState(msg.done, msg.total);
    }
    if (msg.type === 'PRECACHE_DONE') {
      showToast(`${msg.done} Fotos offline gespeichert`);
      reportStorage();
    }
  });
}

/** Schickt eine Nachricht an den aktiven Service Worker. */
async function tellWorker(message) {
  const reg = state.swReady ? await state.swReady : null;
  const sw = reg?.active || navigator.serviceWorker?.controller;
  if (!sw) return null;
  sw.postMessage(message);
  return sw;
}

/**
 * Lädt alle Fotos des aktuellen Pools in den Cache, damit die App später
 * ohne Internet vollständig funktioniert.
 */
async function warmOfflineCache({ silent = false } = {}) {
  if (!navigator.onLine) {
    if (!silent) showToast('Offline — Vorladen nicht möglich.', 'warn');
    return;
  }
  if (!state.pool.length) return;

  const urls = state.pool.map((p) => p.src);
  const sw = await tellWorker({ type: 'PRECACHE_IMAGES', urls });

  if (!sw) {
    // Fallback ohne Service Worker: Bilder einfach in den HTTP-Cache laden.
    urls.forEach((url) => { const img = new Image(); img.src = url; });
    if (!silent) showToast('Fotos werden vorgeladen …');
  } else if (!silent) {
    showToast(`Lade ${urls.length} Fotos für den Offline-Betrieb …`);
  }
}

function updateStorageState(done, total) {
  const el = $('#storageState');
  if (!el) return;
  const percent = total ? Math.round((done / total) * 100) : 0;
  el.innerHTML = `Fotos im Cache: <strong>${done} / ${total}</strong> (${percent} %)`;
}

/** Zeigt an, wie viel Speicher die App belegt. */
async function reportStorage() {
  const el = $('#cacheInfo');
  if (!navigator.storage?.estimate) {
    el.textContent = 'Offline-Cache: aktiv';
    return;
  }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const mb = (usage / 1024 / 1024).toFixed(1);
    const totalGb = (quota / 1024 / 1024 / 1024).toFixed(1);
    el.textContent = `Offline-Cache: ${mb} MB von ${totalGb} GB`;
  } catch {
    el.textContent = 'Offline-Cache: aktiv';
  }
}

function setOnlineState(online) {
  const status = $('#netStatus');
  status.dataset.state = online ? 'online' : 'offline';
  $('#netLabel').textContent = online ? 'online' : 'offline';
  $('#stageHint').hidden = online;

  if (!online) {
    // Offline: keine neuen Fotos aus dem Netz erwarten, aber weiter drehen
    // (der Cache liefert die bereits geladenen Bilder).
    showToast('Offline — Mosaik läuft aus dem lokalen Cache weiter.', 'warn');
  }
}

/* ===========================================================================
   08  Benutzeroberfläche
   =========================================================================== */

let toastTimer;
function showToast(text, tone = 'info') {
  const toast = $('#toast');
  toast.textContent = text;
  toast.dataset.tone = tone;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

function syncSettingsUI() {
  const s = state.settings;
  $('#speedRange').value = String(s.speed);
  $('#optMotion').checked = s.motion;
  $('#optCredits').checked = s.credits;
  $('#optWarm').checked = s.warm;
  $('#optKey').value = s.apiKey || '';
  $('#keyState').textContent = s.apiKey
    ? `Aktiv — Modus: Unsplash-API (${state.pool.length} Fotos geladen)`
    : 'Kein Schlüssel hinterlegt — Modus: kuratierter Bilderpool';
  $('#keyState').className = `help ${s.apiKey ? 'is-ok' : ''}`;
  document.body.classList.toggle('show-credits', s.credits);
  document.body.classList.toggle('no-motion', !s.motion);
}

function applyMotionSetting() {
  // Sanfter Zoom ist eine reine CSS-Frage → Klasse am <html>-Element.
  document.documentElement.classList.toggle('no-kenburns', !state.settings.motion);
}

function detectCapabilities() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const slowNet = /(^|-)2g$/.test(navigator.connection?.effectiveType || '');

  state.lite = cores <= 4 || memory <= 4 || slowNet || state.reducedMotion;
  document.documentElement.classList.toggle('lite', state.lite);
}

function setupInstallPrompt() {
  const buttons = [$('#btnInstall'), $('#btnInstallSheet')].filter(Boolean);
  const isStandalone = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  if (isStandalone) return;

  const showButtons = (visible) => buttons.forEach((b) => { b.hidden = !visible; });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installEvent = event;
    showButtons(true);
  });

  window.addEventListener('appinstalled', () => {
    state.installEvent = null;
    showButtons(false);
    showToast('NeonMosaik wurde installiert 🎉');
  });

  const trigger = async () => {
    if (state.installEvent) {
      state.installEvent.prompt();
      const { outcome } = await state.installEvent.userChoice;
      state.installEvent = null;
      showButtons(false);
      if (outcome !== 'accepted') showToast('Installation abgebrochen', 'warn');
      return;
    }
    showToast('iPhone/iPad: Teilen-Symbol → „Zum Home-Bildschirm“', 'warn');
  };

  buttons.forEach((b) => b.addEventListener('click', trigger));

  // iOS kennt kein beforeinstallprompt — Buttons trotzdem anbieten.
  const isIOS = /iP(hone|ad|od)/.test(navigator.platform) && !window.MSStream;
  if (isIOS) showButtons(true);
}

function setupControls() {
  $('#btnPlay').addEventListener('click', () => setPaused(!state.paused));
  $('#btnShuffle').addEventListener('click', reshuffleAll);
  $('#btnShuffleSheet').addEventListener('click', reshuffleAll);
  $('#btnSettings').addEventListener('click', () => {
    $('#settingsDialog').showModal();
  });

  $('#speedRange').addEventListener('input', (event) => {
    state.settings.speed = clamp(Number(event.target.value), 0, SPEEDS.length - 1);
    settings.save();
    scheduleTick();
  });

  $('#optMotion').addEventListener('change', (event) => {
    state.settings.motion = event.target.checked;
    settings.save();
    applyMotionSetting();
  });

  $('#optCredits').addEventListener('change', (event) => {
    state.settings.credits = event.target.checked;
    settings.save();
    document.body.classList.toggle('show-credits', state.settings.credits);
    state.tiles.forEach((tile) => applyCredit(tile, tile.photo));
  });

  $('#optWarm').addEventListener('change', (event) => {
    state.settings.warm = event.target.checked;
    settings.save();
    if (state.settings.warm) warmOfflineCache();
  });

  $('#btnSaveKey').addEventListener('click', async () => {
    const key = $('#optKey').value.trim();
    state.settings.apiKey = key;
    settings.save();
    showToast(key ? 'Schlüssel gespeichert — lade Zufallsfotos …' : 'Schlüssel entfernt');
    await refreshPool({ force: Boolean(key) });
    buildMosaic({ animate: true });
    syncSettingsUI();
    if (state.settings.warm) warmOfflineCache({ silent: true });
  });

  $('#btnClearKey').addEventListener('click', () => {
    state.settings.apiKey = '';
    settings.save();
    localStorage.removeItem(API_CACHE_KEY);
    $('#optKey').value = '';
    state.mode = 'curated';
    state.pool = shuffle(curatedPhotos());
    buildMosaic({ animate: true });
    syncSettingsUI();
    showToast('Schlüssel gelöscht');
  });

  $('#btnPrecache').addEventListener('click', () => warmOfflineCache());

  $('#btnResetCache').addEventListener('click', async () => {
    await tellWorker({ type: 'CLEAR_CACHES' });
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    showToast('Cache geleert — Seite wird neu geladen …', 'warn');
    setTimeout(() => location.reload(), 1200);
  });

  $('#legal').addEventListener('toggle', (event) => {
    if (event.target.open) {
      // Nach dem Öffnen neu messen, damit das Mosaik sauber weiterläuft.
      setTimeout(() => buildMosaic({ animate: true }), 60);
    }
  });

  window.addEventListener('online', () => setOnlineState(true));
  window.addEventListener('offline', () => setOnlineState(false));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(state.timer);
    else scheduleTick();
  });

  const onResize = debounce(() => {
    if (state.tiles.length) buildMosaic({ animate: true });
  }, 260);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // Tastenkürzel
  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea')) return;
    if (event.code === 'Space') { event.preventDefault(); setPaused(!state.paused); }
    if (event.key.toLowerCase() === 'r') reshuffleAll();
    if (event.key.toLowerCase() === 's') $('#settingsDialog').showModal();
  });
}

/* ===========================================================================
   09  Start
   =========================================================================== */

async function init() {
  state.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  settings.load();
  detectCapabilities();
  setupInstallPrompt();
  setupControls();
  registerServiceWorker();

  // Platzhalter-Raster, damit sofort etwas zu sehen ist.
  const skeleton = $('#skeleton');
  skeleton.replaceChildren(
    ...Array.from({ length: 18 }, () => {
      const cell = document.createElement('div');
      cell.className = 'skeleton__cell';
      return cell;
    }),
  );

  $('#year').textContent = String(new Date().getFullYear());

  setOnlineState(navigator.onLine);
  await refreshPool();

  buildMosaic();
  syncSettingsUI();
  applyMotionSetting();
  setPaused(state.reducedMotion);

  reportStorage();

  // Offline-Vorrat im Hintergrund aufbauen, aber nur wenn sinnvoll.
  const saveData = navigator.connection?.saveData === true;
  if (state.settings.warm && !saveData && navigator.onLine) {
    setTimeout(() => warmOfflineCache({ silent: true }), 2500);
  }
  if (saveData) showToast('Datensparmodus erkannt — Offline-Vorladen übersprungen.', 'warn');

  scheduleTick();
  handleLaunchAction();
}

/** Verarbeitet die PWA-Shortcuts (manifest.webmanifest → "shortcuts"). */
function handleLaunchAction() {
  const action = new URLSearchParams(location.search).get('action');
  if (action === 'settings') setTimeout(() => $('#settingsDialog').showModal(), 500);
  if (action === 'shuffle') setTimeout(() => reshuffleAll(), 700);
}

init().catch((err) => {
  console.error('[NeonMosaik] Start fehlgeschlagen:', err);
  showToast('Beim Start ist etwas schiefgelaufen — siehe Konsole.', 'error');
});

/* Der Service Worker kann Fotos für neue Sitzungen vorhalten. */
window.addEventListener('load', () => {
  navigator.storage?.persist?.().catch(() => {});
});
