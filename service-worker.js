const CACHE_NAME = 'pixeltube-app-js-v5';
const APP_SCRIPTS = [
  './js/main.js?v=15',
  './js/helpers.js',
  './js/storage.js',
  './js/env.js',
  './js/channel.js',
  './js/sec.js',
  './js/studio.js',
  './js/legal.js',
  './js/offline.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SCRIPTS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('pixeltube-app-js-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

  if (requestUrl.pathname.startsWith('/__pixeltube_offline__/')) {
    event.respondWith(caches.open('pixeltube-video-downloads-v1')
      .then(cache => cache.match(new Request(event.request.url)))
      .then(async response => {
        if (!response) return new Response('Offline download not found', { status: 404 });
        const range = event.request.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
        const size = Number(response.headers.get('content-length'));
        if (!range || !size || !response.body) return response;

        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[2] && range[1] ? Math.min(size - 1, Number(range[2])) : size - 1;
        if (start > end || start >= size) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        }

        const reader = response.body.getReader();
        const parts = [];
        let offset = 0;
        let remaining = end - start + 1;
        while (remaining > 0) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunkStart = offset;
          const chunkEnd = chunkStart + value.length;
          offset = chunkEnd;
          const from = Math.max(0, start - chunkStart);
          const to = Math.min(value.length, end + 1 - chunkStart);
          if (to > from) {
            const part = value.slice(from, to);
            parts.push(part);
            remaining -= part.length;
          }
          if (offset > end) {
            await reader.cancel();
            break;
          }
        }
        const headers = new Headers(response.headers);
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
        headers.set('Content-Length', String(end - start + 1));
        headers.set('Accept-Ranges', 'bytes');
        return new Response(new Blob(parts), { status: 206, headers });
      }));
    return;
  }

  if (!requestUrl.pathname.startsWith('/js/') || !requestUrl.pathname.endsWith('.js')) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  }));
});
