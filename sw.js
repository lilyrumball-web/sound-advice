/* Sound Advice — service worker
   Keeps the app openable with no connection. Bump CACHE when you
   change any file, or phones will keep serving the old version. */

const CACHE = 'sound-advice-v5';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './firebase-config.js',
  './js/app.js',
  './js/audio.js',
  './js/store.js',
  './js/gonogo.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './scenes/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);

    // The test photographs are read from scenes/manifest.json rather than
    // listed here, so adding or replacing a photo never means remembering
    // to edit this file too. Roughly 1.3 MB, fetched once.
    try {
      const man = await (await fetch('./scenes/manifest.json')).json();
      const scenes = [...(man.city || []), ...(man.mountain || [])]
        .map(n => `./scenes/${n}`);
      await c.addAll(scenes);
    } catch (err) {
      // Installing on a flaky connection still gives a working app --
      // the fetch handler below caches each photo the first time it loads.
      console.warn('Scenes not pre-cached:', err);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache Firebase or anything else off this site.
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;

  // Network first, so a redeploy is picked up as soon as there's signal,
  // but the cached copy still works on a train with no bars.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
