import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

// Builds sw.js: a service worker that precaches the whole built game (about 4 MB: the code, the card art,
// the icons), so after the first visit it loads instantly and plays offline. Its cache is named after a
// hash of the file list, so every deploy with changed files installs fresh and drops the old cache.

function source(version: string, files: string[]): string {
  return `// Generated at build time by sw-plugin.ts.
const CACHE = 'specimen-${version}';
const FONTS = 'specimen-fonts';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

// The page asks the new version to take over when the player taps "Reload".
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('specimen-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: serve the cached copy, refresh it in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then(async (c) => {
        const hit = await c.match(req);
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      }),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // The page itself: the network when it answers quickly (to pick up a new deploy), else the cached copy.
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cached = await caches.match('./index.html', { ignoreSearch: true, ignoreVary: true });
        try {
          const net = fetch(req);
          return cached ? await Promise.race([net, new Promise((_, no) => setTimeout(no, 2500))]) : await net;
        } catch {
          return cached || Response.error();
        }
      })(),
    );
    return;
  }
  // Everything else is content-hashed: cache first.
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        }),
    ),
  );
});
`;
}

export function serviceWorker(): Plugin {
  return {
    name: 'specimen-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const pub = readdirSync('public').filter((f) => f !== 'sw.js');
      // index.html is emitted after this hook runs, so it is listed by hand.
      const files = ['./', ...new Set(['index.html', ...pub, ...built])].map((f) => (f === './' ? f : `./${f}`));
      // Hash the contents too, so a change to index.html (whose name never changes) still ships a new version.
      const h = createHash('sha256').update(files.join('\n'));
      for (const f of built) {
        const out = bundle[f];
        h.update(out.type === 'chunk' ? out.code : typeof out.source === 'string' ? out.source : Buffer.from(out.source));
      }
      const version = h.digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source(version, files) });
    },
  };
}
