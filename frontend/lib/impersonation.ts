// Admin impersonation. The admin page opens /studio?impersonate=<email> in a
// new tab; this module (imported by ImpersonationBanner in the root layout)
// stashes the email in sessionStorage (per-tab) and patches window.fetch to
// add X-Impersonate-Email to every API call. The backend honors the header
// only when the bearer token belongs to ADMIN_EMAIL.

const KEY = 'lp-impersonate-email'
const API_URL = process.env.NEXT_PUBLIC_API_URL

if (typeof window !== 'undefined') {
  // Runs at module evaluation — before any page effect fires its first fetch.
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('impersonate')
  if (fromUrl) {
    sessionStorage.setItem(KEY, fromUrl)
    params.delete('impersonate')
    const qs = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
  }

  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const email = sessionStorage.getItem(KEY)
    if (email && API_URL) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith(API_URL)) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        headers.set('X-Impersonate-Email', email)
        init = { ...init, headers }
      }
    }
    return originalFetch(input, init)
  }
}

export function getImpersonatedEmail(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(KEY)
}

export function stopImpersonating() {
  sessionStorage.removeItem(KEY)
  window.location.href = '/admin'
}
