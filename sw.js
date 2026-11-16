// Офлайн-режим: приложение открывается из кэша мгновенно и без сети,
// а при каждом запуске кэш целиком обновляется в фоне — новая версия видна со следующего открытия.
// При добавлении файла приложения допишите его в ASSETS.
const CACHE = 'wallet-v2';
const ASSETS = [
  './',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/calc.js',
  'js/catform.js',
  'js/charts.js',
  'js/ctx.js',
  'js/debts.js',
  'js/deposits.js',
  'js/export.js',
  'js/icons.js',
  'js/settings.js',
  'js/stats.js',
  'js/store.js',
  'js/sync.js',
  'js/txsheet.js',
  'js/ui.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// Скачивает все файлы целиком и только потом кладёт их в кэш разом:
// смесь старых и новых файлов не возникает, а при обрыве сети кэш остаётся прежним.
async function refresh() {
  const fresh = await Promise.all(
    ASSETS.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      const body = await res.blob(); // дочитываем сразу, чтобы не держать соединения открытыми
      return [url, new Response(body, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') ?? '' } })];
    }),
  );
  const cache = await caches.open(CACHE);
  await Promise.all(fresh.map(([url, res]) => cache.put(url, res)));
}

self.addEventListener('install', (e) => {
  e.waitUntil(refresh().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wallet-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // запросы к GitHub не трогаем
  const page = req.mode === 'navigate';
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(page ? './' : req, { ignoreSearch: true });
      if (cached) {
        if (page) e.waitUntil(refresh().catch(() => {})); // без сети просто остаёмся на текущей версии
        return cached;
      }
      return fetch(req);
    })(),
  );
});
