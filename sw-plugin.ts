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

// ---------- Daily reminder (opt-in) ----------
// Periodic Background Sync (Chrome / Edge, installed app) wakes the worker now and then; if today's daily
// challenge isn't won yet and no reminder went out today, it shows one notification between 9:00 and 22:00.
// The page leaves what the worker needs (on/off, the last day won, the streak, the next dispatch) in a cache.
const STATE = 'specimen-state';
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
async function readState() {
  const r = await (await caches.open(STATE)).match('./__reminder');
  return r ? r.json() : null;
}
async function writeState(st) {
  await (await caches.open(STATE)).put('./__reminder', new Response(JSON.stringify(st)));
}
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'specimen-daily') return;
  e.waitUntil(
    (async () => {
      const st = await readState();
      if (!st || !st.on) return;
      const today = dayKey();
      const hour = new Date().getHours();
      if (st.wonDay === today || st.notifiedDay === today || hour < 9 || hour >= 22) return;
      const body = st.streak > 0 ? 'Keep your ' + st.streak + '-day streak going. Dispatch ' + st.dispatch + ' is waiting.' : "Today's twist and Dispatch " + st.dispatch + ' are waiting.';
      await self.registration.showNotification('A new Specimen challenge is ready', { body, tag: 'specimen-daily', icon: './icon-192.png', badge: './icon-192.png', data: { url: './#daily' } });
      await writeState({ ...st, notifiedDay: today });
    })(),
  );
});
// Online play while the game is closed: "Ben challenges you", "Ana is online". If the game is open and in view,
// the lounge already shows it, so no notification.
self.addEventListener('push', (e) => {
  let msg = { title: 'Specimen', body: '', url: './#lounge', tag: 'online' };
  try {
    msg = { ...msg, ...e.data.json() };
  } catch {
    /* a message without a body */
  }
  e.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (open.some((c) => c.visibilityState === 'visible' && c.focused)) return;
      await self.registration.showNotification(msg.title, { body: msg.body, tag: msg.tag, renotify: true, icon: './icon-192.png', badge: './icon-192.png', data: { url: msg.url } });
    })(),
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of open) {
        if ('focus' in c) {
          if ('navigate' in c) await c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});

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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('specimen-') && k !== CACHE && k !== FONTS && k !== STATE).map((k) => caches.delete(k))))
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
