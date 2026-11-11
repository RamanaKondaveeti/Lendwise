const CACHE_PREFIX = 'groupbuk-static-'
const CACHE_NAME = 'groupbuk-static-v1'
const STATIC_FILES = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    const shellResponse = await fetch('/')
    if (!shellResponse.ok) throw new Error('Could not cache the GroupBuk app shell.')
    const shellHtml = await shellResponse.clone().text()
    const assets = [...shellHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => new URL(match[1], self.location.origin))
      .filter(url => url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
      .map(url => url.href)
    await cache.put('/', shellResponse)
    await cache.addAll([...STATIC_FILES.filter(path => path !== '/'), ...assets])
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    const versions = names.filter(name => name.startsWith(CACHE_PREFIX)).sort().reverse()
    const isUpdate = versions.some(name => name !== CACHE_NAME)
    await Promise.all(versions.slice(2).filter(name => name !== CACHE_NAME).map(name => caches.delete(name)))
    await self.clients.claim()
    if (isUpdate) {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      windows.forEach(client => client.postMessage({ type: 'GROUPBUK_SW_ACTIVATED' }))
    }
  })())
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put('/', response.clone())
        }
        return response
      } catch {
        const offlineShell = await (await caches.open(CACHE_NAME)).match('/')
        return offlineShell || new Response('GroupBuk is offline. Reconnect to load your account data.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    })())
    return
  }

  const isAppAsset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  if (!isAppAsset) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = url.pathname.startsWith('/assets/') ? await caches.match(request) : await cache.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok && response.type === 'basic' && !response.headers.get('Cache-Control')?.includes('no-store')) {
        await cache.put(request, response.clone())
      }
      return response
    } catch {
      return new Response('This app asset is not available offline.', { status: 503 })
    }
  })())
})
