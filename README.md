# NeonMosaik

Eine moderne, responsive **Progressive Web App**, die ein lebendiges Mosaik aus
zufälligen Unsplash-Fotos zeigt. Die einzelnen Mosaiksteine wechseln laufend,
das Ganze ist in einem Neon-Glow-Look mit Helvetica-artiger Typografie gehalten
und läuft nach dem ersten Besuch **vollständig offline**.

---

## Schnellstart

```bash
cd bigpickle-diashow
npm start
```

Dann im Browser öffnen: **http://localhost:8080**

> Ohne npm geht es auch mit jedem anderen statischen Server, z. B.
> `python3 -m http.server 8080`.

**Warum ein Server und nicht einfach `index.html` doppelklicken?**
Service Worker — und damit der komplette Offline-Betrieb — funktionieren aus
Sicherheitsgründen nur über `http://localhost` oder `https://`, nicht über
`file://`.

---

## Funktionen

| Bereich | Umsetzung |
|---|---|
| **Galerie** | Lückenloses Mosaik-Raster: jede Fläche wird von rechteckigen Kacheln (1×1, 2×1, 1×2, 2×2) exakt gefüllt — keine Löcher, keine Überläufe. |
| **Bewegung** | Alle paar Sekunden tauschen zufällige Kacheln ihr Foto per weicher Überblendung aus. Zusätzlich ein sehr langsamer „Atem“-Zoom pro Foto. |
| **Steuerung** | Pause/Start, „Mischen“, Wechsel-Tempo in fünf Stufen. |
| **Farben** | Dunkle Basis mit Neon-Akzenten (Cyan, Magenta, Violett, Limette, Amber), Glas-Optik, animierte Aurora im Hintergrund. |
| **Schrift** | Helvetica-Stack (`"Helvetica Neue", Helvetica, …`) — systemnah, damit offline keine Webfont-Downloads nötig sind. |
| **Responsive** | Vom 320-px-Smartphone bis zum 4K-Monitor. Das Raster wird live aus der verfügbaren Fläche berechnet. |
| **PWA** | Installierbar (eigener Startbildschirm-Eintrag), App-Shell + Fotos im Cache, funktioniert komplett offline. |
| **Datenschutz** | Kein Server, kein Tracking, keine Cookies. Alle Einstellungen bleiben im `localStorage` des Geräts. |

### Bedienung

* **Klick auf „Pause“** — Animation anhalten/fortsetzen
* **Klick auf „Mischen“** — alle Kacheln neu bestücken
* **Klick auf „Optionen“** — Tempo, Effekte, Unsplash-Schlüssel, Offline-Speicher
* **Klick auf eine Kachel** (bei aktivierten Urheber-Labels) — Foto bei Unsplash öffnen
* **Tastatur** — `Leertaste` Pause, `R` mischen, `S` Optionen

---

## Offline-Funktion (Kernstück)

Die App ist so gebaut, dass sie **nach dem ersten Besuch ohne Internet
vollständig weiterläuft** — inklusive der Fotos.

**`sw.js` (Service Worker)**

| Anfrage | Strategie |
|---|---|
| App-Shell (HTML, CSS, JS, Icons) | **Cache-First**, versioniert. Ein neuer Service Worker installiert einen kompletten, zueinander passenden Satz. |
| Navigationen | **Cache-First**, danach Netz; letzter Ausweg: eine Notfall-Offline-Seite. |
| Fotos (`images.unsplash.com`) | **Cache-First**. Jedes Foto existiert pro Auflösung unter genau einer URL → der Cache ist eindeutig, klein und zuverlässig. |
| Unsplash-API | wird **nie** gecacht (der Access Key steckt in der URL). |
| Fehlende Bilder offline | hübsche Neon-SVG-Kachel statt kaputtem Bildsymbol. |

**Vorladen für Offline**

Damit die Galerie auch beim Wechseln der Kacheln offline funktioniert, lädt die
App im Hintergrund **alle 64 Fotos des Pools** in den Cache (`PRECACHE_IMAGES`).
Der Service Worker lädt mit 4 parallelen Verbindungen und meldet den Fortschritt
zurück. Typischer Speicherbedarf: **ca. 3 MB** auf dem Smartphone.

*Der Cache wird auf 256 Bilder begrenzt (FIFO).*

**In den Optionen**

* „Alle Fotos für Offline-Nutzung vorladen“ — ein-/ausschalten
* „Jetzt offline-fähig machen“ — Vorladen manuell starten
* „Cache leeren“ — alle gespeicherten Daten entfernen und neu laden
* Statusanzeige mit belegtem Speicher (`navigator.storage.estimate()`)

**Installieren**

* **Android/Chrome/Edge:** Button „Installieren“ im Kopfbereich
* **iPhone/iPad (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“
* **Desktop:** Installationssymbol in der Adressleiste

---

## Projektstruktur

```
bigpickle-diashow/
├── index.html              Aufbau: Kopfleiste, Mosaik-Bühne, Footer, Options-Dialog
├── styles.css              Design-Tokens, Layout, Neon-Effekte (nach Themen sortiert)
├── app.js                  Anwendungslogik
│                             · Mosaik-Geometrie (lückenloses Packing)
│                             · Kacheln & Überblendung
│                             · Bilderquellen (Pool / Unsplash-API)
│                             · Rotation, Offline-Vorladen, UI
├── photos.js               Bilderpool (64 verifizierte IDs), URL-Bau, Neon-Palette
├── sw.js                   Service Worker: Caching-Strategien & Offline-Logik
├── manifest.webmanifest    PWA-Manifest (Name, Icons, Shortcuts, Farben)
├── server.mjs              kleiner statischer Server für die Entwicklung
├── package.json            `npm start`
├── icons/                  App-Icons (SVG-Quellen + generierte PNGs)
│   ├── icon.svg / icon-512.png / icon-192.png
│   ├── icon-maskable.svg / icon-maskable-512.png
│   ├── apple-touch-icon.png / favicon.svg / favicon-32.png
└── README.md
```

---

## Anpassen

**Eigene Fotos in den Pool aufnehmen** — in `photos.js`:

```js
export const CURATED_PHOTO_IDS = [
  '1506744038136-46273834b3fb',   // ← Dateiname-Teil einer Unsplash-URL:
  // …                                https://images.unsplash.com/photo-<ID>
];
```

**Farben & Schrift** — alle Werte stehen oben in `styles.css` unter
`01 Design-Tokens`:

```css
--cyan: #00f0ff;   --magenta: #ff2bd6;   --lime: #b6ff2b;
--font-sans: "Helvetica Neue", Helvetica, Inter, system-ui, …;
```

**Wechsel-Tempo** — in `app.js` das Array `SPEEDS` (Zeitfenster und Anzahl der
Kacheln pro Takt).

**Bildauflösung / Speicherbedarf** — `preferredImageWidth()` in `photos.js`
wählt 480/640/900/1200 px automatisch passend zu Fensterbreite und
Pixeldichte.

---

## Nach Änderungen: Cache-Version erhöhen

Die App-Shell liegt versioniert im Cache. Damit Nutzer nach einem Update die
neuen Dateien bekommen, muss in `sw.js` die Version erhöht werden:

```js
const VERSION = 'v1.0.1';   // ← bei jeder Änderung an index.html/styles.css/app.js/photos.js
```

Der neue Service Worker installiert dann automatisch einen frischen, in sich
stimmigen Satz aller Shell-Dateien. Für einen sofortigen Neustart während der
Entwicklung: Browser-Konsole → `Application → Service Workers → Unregister`.

---

## Deployment

Alle Dateien sind statisch. Einfach den Ordner hochladen — fertig.

* **HTTPS ist Pflicht**, sonst kein Service Worker.
* Wird die App in einem **Unterordner** gehostet, funktioniert alles trotzdem:
  alle Pfade sind relativ (`./`) und der Service Worker leitet seine Basis-URL
  aus seinem eigenen Ablageort ab.

Beispiele: GitHub Pages, Netlify, Vercel, Cloudflare Pages, eigener nginx.

---

## Bilder, Quellen & Rechtliches

* **Alle Fotos stammen von [Unsplash](https://unsplash.com)** und werden gemäß
  den Unsplash-Richtlinien direkt vom CDN (`images.unsplash.com`) eingebunden —
  die Bilder werden **nicht** heruntergeladen und neu ausgeliefert.
* Nutzung unter der [Unsplash-Lizenz](https://unsplash.com/license).
* Ohne Zugangsschlüssel zeigt die App den kuratierten Pool mit dem Hinweis
  „© Unsplash“. Für echte Zufallsfotos **inklusive Namen und Profil-Link der
  Fotograf:innen** kann in den Optionen ein Unsplash-Access-Key hinterlegt
  werden (kostenlos auf [unsplash.com/developers](https://unsplash.com/developers)).
  Der Schlüssel wird ausschließlich lokal gespeichert.
* Die App ist nicht mit Unsplash verbunden und wird nicht von Unsplash gesponsert.

**Datenverarbeitung:** Diese App hat keinen eigenen Server. Es werden keine
Nutzerdaten übertragen, es gibt kein Tracking und keine Analyse. Gespeichert
werden nur lokal: die eigenen Einstellungen (`localStorage`) und die Bilder für
den Offline-Betrieb (`Cache Storage`). Einzige externe Verbindung ist das Laden
der Fotos von Unsplash.

Das Impressum im Fußbereich ist ein **Pseudo-Impressum** mit Platzhalterdaten —
für einen echten Einsatz bitte durch korrekte Angaben ersetzen.

---

## Technischer Hintergrund

* **Kein Framework, kein Build-Schritt.** Reines HTML, CSS und ES-Module.
* **Mosaik-Packing:** `packMosaic()` in `app.js` belegt ein Raster Zelle für
  Zelle, prüft für jede freie Zelle, welche Kachelformen (gewichtet) noch
  hineinpassen, und markiert die belegten Flächen. Dadurch ist die Abdeckung
  garantiert vollständig und überlauffrei.
* **Zwei Bildebenen pro Kachel:** Das neue Foto lädt unsichtbar im Hintergrund
  und wird erst nach dem `load`-Event eingeblendet — kein Flackern.
* **Rücksicht auf schwache Geräte:** `detectCapabilities()` prüft CPU-Kerne,
  Speicher, Netztyp und `prefers-reduced-motion` und aktiviert bei Bedarf einen
  „Lite“-Modus (weniger Blur, keine Hintergrund-Animationen).
* **Barrierefreiheit:** Skip-Link, Fokus-Stile, `aria`-Attribute,
  Tastaturkürzel, `prefers-reduced-motion` wird vollständig respektiert.

Viel Spaß mit dem NeonMosaik. ✨
