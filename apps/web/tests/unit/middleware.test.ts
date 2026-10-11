// Middleware : politique CSP à nonce sur chaque page, garde de session sur
// les routes de l'app.
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { contentSecurityPolicy, middleware } from '@/middleware'

function request(path: string, cookie?: string) {
  return new NextRequest(`https://spellcache.test${path}`, {
    headers: cookie ? { cookie } : {},
  })
}

describe('middleware', () => {
  it('sends a fresh nonce policy with every page, public ones included', () => {
    const first = middleware(request('/login')).headers.get('content-security-policy')
    const second = middleware(request('/login')).headers.get('content-security-policy')

    expect(first).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
    expect(first).not.toBe(second)
  })

  it('hands the policy to Next on the request, so its scripts carry the nonce', () => {
    const response = middleware(request('/s/abc'))
    const forwarded = response.headers.get('x-middleware-request-content-security-policy')

    expect(forwarded).toBe(response.headers.get('content-security-policy'))
  })

  it('redirects an app route without a session cookie to the login screen', () => {
    const response = middleware(request('/collection'))

    expect(response.headers.get('location')).toBe('https://spellcache.test/login')
  })

  it('lets an app route with a session cookie through', () => {
    const response = middleware(request('/settings/collection', 'authjs.session-token=x'))

    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('content-security-policy')).toContain("object-src 'none'")
  })

  it('allows eval and WebSockets in development only', () => {
    expect(contentSecurityPolicy('n', true)).toContain("'unsafe-eval'")
    expect(contentSecurityPolicy('n', false)).not.toContain("'unsafe-eval'")
    expect(contentSecurityPolicy('n', false)).not.toContain('ws:')
  })
})
