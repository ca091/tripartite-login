import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Run against an already running local server. Never follows provider auth URLs.
const base = process.env.AUTH_SMOKE_URL || 'http://localhost:3000'
const post = (path, body, cookie, origin = base) => fetch(base + path, {
  method: 'POST',
  headers: {
    ...(origin ? { Origin: origin } : {}),
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {})
  },
  body: JSON.stringify(body ?? {})
})

const response = await fetch(base + '/api/auth/status')
assert.equal(response.status, 200)
assert.equal(response.headers.get('cache-control'), 'no-store')
const statuses = await response.json()
assert.equal(statuses.length, 3)

for (const { provider, configured } of statuses) {
  assert.equal((await post(`/api/auth/${provider}/start`, {}, null, '')).status, 403)
  assert.equal((await post(`/api/auth/${provider}/start`, {}, null, 'https://foreign.example')).status, 403)
  const started = await post(`/api/auth/${provider}/start`)
  assert.equal(started.status, configured ? 200 : 503)
  if (!configured) continue
  const cookie = started.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Lax/i)
  const binding = cookie.split(';')[0]
  const challenge = await started.json()
  assert.ok(challenge.nonce)
  assert.equal('verifier' in challenge, false)
  if (provider === 'google') {
    assert.equal((await post('/api/auth/google/verify', { credential: 'not-a-jwt' }, binding)).status, 401)
    assert.equal((await post('/api/auth/google/verify', { credential: 'not-a-jwt' }, binding)).status, 400)
  } else if (provider === 'github') {
    const url = new URL(challenge.authorizationUrl)
    assert.equal(url.origin, 'https://github.com')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.has('client_secret'), false)
    assert.equal((await post('/api/auth/github/verify', { code: 'fake', state: 'tampered' }, binding)).status, 400)
    assert.equal((await post('/api/auth/github/verify', { code: 'fake', state: challenge.state }, binding)).status, 400)
  } else {
    assert.equal((await post('/api/auth/apple/cancel', {}, binding)).status, 200)
    assert.equal((await post('/api/auth/apple/verify', { code: 'fake', state: challenge.state }, binding)).status, 400)
  }
}

assert.equal((await post('/api/auth/unknown/start')).status, 404)
for (const doc of ['README', 'google', 'apple', 'github']) {
  const result = await fetch(base + `/docs/auth/${doc}.md`)
  assert.equal(result.status, 200)
  assert.equal(await result.text(), await readFile(new URL(`../docs/auth/${doc}.md`, import.meta.url), 'utf8'))
}
for (const path of ['/', '/auth/callback-github']) {
  assert.equal((await fetch(base + path)).status, 200)
}
for (const provider of ['google', 'apple', 'github']) {
  for (const path of [`/${provider}`, `/examples/${provider}`]) {
    const result = await fetch(base + path, { redirect: 'manual' })
    assert.equal(result.status, 404, `${path} must not expose a standalone provider page or redirect`)
  }
}
console.log('HTTP smoke passed: pages/docs, provider routing, origin checks, cookie binding, PKCE and replay rejection. No third-party authorization attempted.')
