import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { isIosSafari, isStandalone, promptInstall, registerServiceWorker } from '../src/pwa.mjs'

const manifestUrl = new URL('../public/manifest.webmanifest', import.meta.url)
const swUrl = new URL('../public/sw.js', import.meta.url)
const iconUrl = name => new URL(`../public/icons/${name}`, import.meta.url)

test('manifest is installable and includes the required app identity, scope, and icons', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  assert.equal(manifest.name, 'GroupBuk')
  assert.equal(manifest.short_name, 'GroupBuk')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  for (const size of [192, 512]) assert.ok(manifest.icons.some(icon => icon.sizes === `${size}x${size}` && icon.type === 'image/png'))
  for (const size of [192, 512]) {
    const file = await readFile(iconUrl(size === 192 ? 'icon-192.png' : 'icon-512.png'))
    assert.equal(file.toString('hex', 0, 8), '89504e470d0a1a0a')
    assert.equal(file.readUInt32BE(16), size)
    assert.equal(file.readUInt32BE(20), size)
  }
})

test('standalone and iPhone Safari detection avoids installed and non-Safari browsers', () => {
  assert.equal(isStandalone({ displayModeMatches: true }), true)
  assert.equal(isStandalone({ legacyStandalone: true }), true)
  assert.equal(isStandalone(), false)
  assert.equal(isIosSafari({ userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit Safari/605.1' }), true)
  assert.equal(isIosSafari({ userAgent: 'Mozilla/5.0 (iPhone) CriOS/120 Safari/605.1' }), false)
  assert.equal(isIosSafari({ userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1', standalone: true }), false)
})

test('install prompt handles accept, dismiss, and unsupported browsers', async () => {
  let prompts = 0
  assert.equal(await promptInstall({ prompt: async () => { prompts += 1 }, userChoice: Promise.resolve({ outcome: 'accepted' }) }), 'accepted')
  assert.equal(await promptInstall({ prompt: async () => { prompts += 1 }, userChoice: Promise.resolve({ outcome: 'dismissed' }) }), 'dismissed')
  assert.equal(await promptInstall(null), 'unsupported')
  assert.equal(prompts, 2)
})

test('service worker registration requests the root scope and detects waiting updates', async () => {
  const listeners = new Map()
  const installingListeners = new Map()
  const installing = {
    state: 'installed',
    addEventListener: (name, callback) => installingListeners.set(name, callback),
  }
  const registration = {
    waiting: {},
    installing,
    addEventListener: (name, callback) => listeners.set(name, callback),
  }
  const serviceWorker = {
    controller: {},
    register: async (...args) => { serviceWorker.args = args; return registration },
  }
  let updates = 0
  assert.equal(await registerServiceWorker({ serviceWorker }, () => { updates += 1 }), registration)
  assert.deepEqual(serviceWorker.args, ['/sw.js', { scope: '/' }])
  listeners.get('updatefound')()
  installingListeners.get('statechange')()
  assert.equal(updates, 2)
  assert.equal(await registerServiceWorker({}, () => {}), null)
})

test('service worker explicitly bypasses API and non-static requests', async () => {
  const serviceWorker = await readFile(swUrl, 'utf8')
  assert.match(serviceWorker, /url\.pathname === '\/api' \|\| url\.pathname\.startsWith\('\/api\/'\)\) return/)
  assert.match(serviceWorker, /request\.method !== 'GET'/)
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/assets\/'\)/)
  assert.doesNotMatch(serviceWorker, /localStorage|Authorization|Bearer /)

  const listeners = new Map()
  runInNewContext(serviceWorker, {
    URL,
    self: { location: { origin: 'https://groupbuk.example' }, addEventListener: (name, handler) => listeners.set(name, handler) },
  })
  for (const [pathname, method] of [['/api/auth/logout', 'POST'], ['/api/groups/2/activity', 'GET'], ['/api/expenses', 'GET']]) {
    let intercepted = false
    listeners.get('fetch')({
      request: { method, url: `https://groupbuk.example${pathname}`, mode: 'cors' },
      respondWith: () => { intercepted = true },
    })
    assert.equal(intercepted, false, `${method} ${pathname} should remain network-only`)
  }
})
