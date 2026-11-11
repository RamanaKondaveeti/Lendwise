export function isStandalone({ displayModeMatches = false, legacyStandalone = false } = {}) {
  return Boolean(displayModeMatches || legacyStandalone)
}

export function isIosSafari({ userAgent = '', platform = '', maxTouchPoints = 0, standalone = false } = {}) {
  if (standalone) return false
  const iosDevice = /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  const safari = /Safari/i.test(userAgent) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(userAgent)
  return iosDevice && safari
}

export async function promptInstall(event) {
  if (!event?.prompt) return 'unsupported'
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed'
  } catch {
    return 'dismissed'
  }
}

export async function registerServiceWorker(navigatorRef, onUpdateAvailable = () => {}) {
  if (!navigatorRef?.serviceWorker?.register) return null
  const registration = await navigatorRef.serviceWorker.register('/sw.js', { scope: '/' })
  if (registration.waiting && navigatorRef.serviceWorker.controller) onUpdateAvailable(registration)
  registration.addEventListener?.('updatefound', () => {
    const installing = registration.installing
    installing?.addEventListener?.('statechange', () => {
      if (installing.state === 'installed' && navigatorRef.serviceWorker.controller) onUpdateAvailable(registration)
    })
  })
  return registration
}
