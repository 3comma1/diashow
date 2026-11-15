/**
 * photos.js — Datenquellen & Bild-URLs
 * ---------------------------------------------------------------------------
 * Alle Bilder stammen von Unsplash und werden gemäß den Unsplash-Richtlinien
 * direkt vom Unsplash-CDN geladen (Hotlinking).
 *
 * Die Liste enthält ausschließlich verifizierte Foto-IDs. Eine ID entspricht
 * dem Dateinamen-Teil einer Unsplash-Bild-URL:
 *
 *   https://images.unsplash.com/photo-<ID>
 *
 * Vorteil dieses Aufbaus: Für jedes Foto existiert genau *eine* URL pro
 * Auflösung. Das macht den Offline-Cache eindeutig, klein und zuverlässig —
 * die Service-Worker-Strategie kann jede Anfrage exakt einem Foto zuordnen.
 */

/** Auflösungen, die die App verwendet (Breite in Pixel). */
export const IMAGE_WIDTH = 900;
export const IMAGE_QUALITY = 72;

/**
 * Wählt eine sinnvolle Bildbreite für das aktuelle Gerät.
 * Größere Kacheln entstehen nur durch Mehrfach-Spannen (max. ~2 Spalten),
 * deshalb genügt ein Bruchteil der Fensterbreite. Das spart Datenvolumen
 * und macht den Offline-Cache deutlich kleiner.
 *
 * @returns {number} 480 | 640 | 900 | 1200
 */
let cachedWidth = null;

export function preferredImageWidth() {
  if (cachedWidth) return cachedWidth;
  const viewport = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const tilePx = Math.max(140, Math.min(viewport / 3, 640));
  const needed = tilePx * dpr;
  cachedWidth = needed <= 480 ? 480 : needed <= 640 ? 640 : needed <= 900 ? 900 : 1200;
  return cachedWidth;
}

/** Neon-Palette für Kachel-Ränder und Glow. */
export const NEON_PALETTE = [
  '#00f0ff',
  '#00f0ff',
  '#ff2bd6',
  '#a86bff',
  '#b6ff2b',
  '#ffb02b',
];

/** Zentrale Unsplash-Links (mit Quellenangabe für den Referral). */
export const UNSPLASH = {
  home: 'https://unsplash.com/?utm_source=neonmosaik&utm_medium=referral',
  license: 'https://unsplash.com/license?utm_source=neonmosaik&utm_medium=referral',
  imageBase: 'https://images.unsplash.com/photo-',
  photoPage: 'https://unsplash.com/photos/',
  api: 'https://api.unsplash.com',
  referral: '?utm_source=neonmosaik&utm_medium=referral',
};

/**
 * Baut die Anzeige-URL für eine kuratierte Foto-ID.
 * @param {string} id  Foto-ID (ohne das Präfix "photo-")
 * @param {number} [width] Standard: geräteabhängig (siehe preferredImageWidth)
 * @returns {string}
 */
export function imageUrl(id, width = preferredImageWidth()) {
  const params = new URLSearchParams({
    auto: 'format',
    fit: 'crop',
    fm: 'webp',
    q: String(IMAGE_QUALITY),
    w: String(width),
  });
  return `${UNSPLASH.imageBase}${id}?${params}`;
}

/**
 * Hängt die Anzeige-Parameter an eine rohe Unsplash-URL an
 * (wird im API-Modus für `urls.raw` benötigt).
 * @param {string} raw
 * @param {number} [width]
 * @returns {string}
 */
export function tuneRawUrl(raw, width = preferredImageWidth()) {
  const extra = `fm=webp&fit=crop&q=${IMAGE_QUALITY}&w=${width}`;
  return raw + (raw.includes('?') ? '&' : '?') + extra;
}

/** Kuratierter Pool aus 64 verifizierten Unsplash-Fotos. */
export const CURATED_PHOTO_IDS = [
  '1506744038136-46273834b3fb',
  '1506905925346-21bda4d32df4',
  '1441974231531-c6227db76b6e',
  '1470071459604-3b5ec3a7fe05',
  '1465146344425-f00d5f5c8f07',
  '1501854140801-50d01698950b',
  '1472214103451-9374bd1c798e',
  '1447752875215-b2761acb3c5d',
  '1426604966848-d7adac402bff',
  '1433086966358-54859d0ed716',
  '1469474968028-56623f02e42e',
  '1444927714506-8492d94b4e3d',
  '1501785888041-af3ef285b470',
  '1439066615861-d1af74d74000',
  '1518173946687-a4c8892bbd9f',
  '1445966275305-9806327ea2b5',
  '1500530855697-b586d89ba3ee',
  '1519681393784-d120267933ba',
  '1493246507139-91e8fad9978e',
  '1508739773434-c26b3d09e071',
  '1483728642387-6c3bdd6c93e5',
  '1454391304352-2bf4678b1a7a',
  '1475924156734-496f6cac6ec1',
  '1518098268026-4e89f1a2cd8e',
  '1489515217757-5fd1be406fef',
  '1470252649378-9c29740c9fa8',
  '1494548162494-384bba4ab999',
  '1502082553048-f009c37129b9',
  '1418065460487-3e41a6c84dc5',
  '1476231682828-37e571bc172f',
  '1439853949127-fa647821eba0',
  '1505765050516-f72dcac9c60e',
  '1462331940025-496dfbfc7564',
  '1451187580459-43490279c0fa',
  '1465101162946-4377e57745c3',
  '1502134249126-9f3755a50d78',
  '1446776811953-b23d57bd21aa',
  '1533105079780-92b9be482077',
  '1507525428034-b723cf961d3e',
  '1519046904884-53103b34b206',
  '1505142468610-359e7d316be0',
  '1471922694854-ff1b63b20054',
  '1497436072909-60f360e1d4b1',
  '1500534314209-a25ddb2bd429',
  '1449824913935-59a10b8d2000',
  '1477959858617-67f85cf4f1df',
  '1480714378408-67cf0d13bc1b',
  '1514565131-fce0801e5785',
  '1496568816309-51d7c20e3b21',
  '1513635269975-59663e0ac1ad',
  '1502602898657-3e91760cbb34',
  '1499856871958-5b9627545d1a',
  '1474511320723-9a56873867b5',
  '1425082661705-1834bfd09dca',
  '1500462918059-b1a0cb512f1d',
  '1552053831-71594a27632d',
  '1517849845537-4d257902454a',
  '1518791841217-8f162f1e1131',
  '1470770841072-f978cf4d019e',
  '1490750967868-88aa4486c946',
  '1508615039623-a25605d2b022',
  '1511300636408-a63a89df3482',
  '1494791368093-85217fbbf8de',
  '1504609813442-a8924e83f76e',
];
