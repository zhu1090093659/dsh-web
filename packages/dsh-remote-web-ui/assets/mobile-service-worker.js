/* PWA worker for the standalone /m mobile shell. */
const CACHE_NAME = 'dsh-remote-mobile-shell-v1'
const OFFLINE_URL = '/m/offline.html'
const SHELL_PATHS = new Set([
  '/m/',
  '/m/mobile.js',
  '/m/manifest.webmanifest',
  '/m/apple-touch-icon.png',
  '/m/icon-192.png',
  '/m/icon-512.png',
  OFFLINE_URL,
])

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL)))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys
      .filter(key => key.startsWith('dsh-remote-mobile-shell-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)),
  )))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/m/api' || url.pathname.startsWith('/m/api/')) return

  const isMobileNavigation = request.mode === 'navigate' && (url.pathname === '/m/' || url.pathname === '/m')
  if (isMobileNavigation) {
    event.respondWith(networkFirst(request, OFFLINE_URL, false))
    return
  }

  if (SHELL_PATHS.has(url.pathname)) event.respondWith(networkFirst(request, url.pathname))
})

async function networkFirst(request, fallbackPath, allowCachedResponse = true) {
  try {
    const response = await fetch(request)
    if (response.status >= 500) throw new Error('mobile shell unavailable')
    if (response.ok && new URL(request.url).search === '') {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(CACHE_NAME)
    if (allowCachedResponse) {
      const cached = await cache.match(request)
      if (cached !== undefined) return cached
    }

    const fallback = await cache.match(fallbackPath)
    if (fallback !== undefined) return fallback

    return new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}
