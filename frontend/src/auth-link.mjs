// Bearer tokens belong in URL fragments so they are not sent in HTTP requests,
// access logs, or Referer headers. Query parsing remains for older emailed links.
export function readAuthLink(href) {
  const url = new URL(href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  const invite = fragment.get('invite') || url.searchParams.get('invite')
  const reset = fragment.get('reset') || url.searchParams.get('reset')
  const shouldClean = Boolean(invite || reset || url.searchParams.has('verify') || fragment.has('verify'))

  if (shouldClean) {
    url.searchParams.delete('invite')
    url.searchParams.delete('reset')
    url.searchParams.delete('verify')
    fragment.delete('invite')
    fragment.delete('reset')
    fragment.delete('verify')
    const remainingFragment = fragment.toString()
    url.hash = remainingFragment ? `#${remainingFragment}` : ''
  }

  return {
    invite,
    reset,
    shouldClean,
    cleanUrl: `${url.pathname}${url.search}${url.hash}`,
  }
}
