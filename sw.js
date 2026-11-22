```javascript
const CACHE_NAME = 'rishi-music-gh-v5';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './voice-dj.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// INSTALL
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await cache.addAll(ASSETS_TO_CACHE);
        })
    );

    self.skipWaiting();
});

// ACTIVATE
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.map((key) => {
                    if (
                        key.startsWith('rishi-music-') &&
                        key !== CACHE_NAME
                    ) {
                        return caches.delete(key);
                    }
                })
            )
        )
    );

    self.clients.claim();
});

// FETCH
self.addEventListener('fetch', (event) => {
    const request = event.request;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    if (
        url.protocol === 'data:' ||
        url.protocol === 'blob:'
    ) return;

    event.respondWith(
        caches.match(request).then(async (cachedResponse) => {

            if (cachedResponse) {
                return cachedResponse;
            }

            try {
                const networkResponse = await fetch(request);

                if (networkResponse && networkResponse.ok) {

                    const cache = await caches.open(CACHE_NAME);

                    if (
                        request.destination === 'script' ||
                        request.destination === 'style' ||
                        request.destination === 'document' ||
                        request.destination === 'image' ||
                        request.destination === 'font' ||
                        url.pathname.endsWith('.json')
                    ) {
                        await cache.put(
                            request,
                            networkResponse.clone()
                        );
                    }
                }

                return networkResponse;

            } catch (error) {

                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }

                return new Response(
                    'You are offline. Please try again later.',
                    {
                        status: 503,
                        headers: {
                            'Content-Type': 'text/plain'
                        }
                    }
                );
            }
        })
    );
});
```
