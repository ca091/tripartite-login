import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { microsoftIssuer, microsoftRedirectUri, microsoftTenant } from '../shared/microsoft.ts'
import { ChallengeStore, publicIdentity } from '../server/utils/auth-core.ts'
import { createMicrosoftKeySet, verifyMicrosoftIdentityToken } from '../server/utils/microsoft-tokens.ts'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'personal-key', use: 'sig', alg: 'RS256' }
const now = () => Math.floor(Date.now() / 1000)
const claims = () => ({ sub: 'personal-user', tid: microsoftTenant, ver: '2.0', nonce: 'server-nonce', iss: microsoftIssuer, aud: 'our-client', iat: now(), nbf: now(), exp: now() + 300 })
const sign = (changes = {}, key = privateKey, header = {}) => new SignJWT({ ...claims(), ...changes })
  .setProtectedHeader({ alg: 'RS256', kid: 'personal-key', ...header }).sign(key)

function keys(issuer = microsoftIssuer) {
  let fetched = 0
  const resolver = createMicrosoftKeySet(async (url, options) => {
    assert.equal(url, 'https://login.microsoftonline.com/consumers/discovery/v2.0/keys')
    assert.equal(options.redirect, 'manual')
    fetched++
    return Response.json({ keys: [{ ...jwk, issuer }] })
  })
  return { resolver, get fetched() { return fetched } }
}

test('personal ID tokens verify with scoped Microsoft keys and reuse the JWKS cache', async () => {
  for (const issuer of [microsoftIssuer, 'https://login.microsoftonline.com/{tenantid}/v2.0']) {
    const remote = keys(issuer)
    const token = await sign({ name: 'Alice', email: 'alice@outlook.com' })
    const payload = await verifyMicrosoftIdentityToken(token, 'our-client', 'server-nonce', remote.resolver)
    assert.equal(payload.sub, 'personal-user')
    await verifyMicrosoftIdentityToken(token, 'our-client', 'server-nonce', remote.resolver)
    assert.equal(remote.fetched, 1)
  }
})

test('Microsoft verification rejects organizational accounts and invalid claims or signatures', async () => {
  const { resolver } = keys()
  const foreign = await generateKeyPair('RS256')
  const invalid = [
    { iss: 'https://login.microsoftonline.com/consumers/v2.0' },
    { iss: 'https://attacker.example/v2.0' },
    { tid: '11111111-2222-3333-4444-555555555555' },
    { ver: '1.0' }, { aud: 'other-client' }, { nonce: 'other-nonce' },
    { exp: now() - 10 }, { nbf: now() + 600 }, { sub: '' }
  ]
  for (const changes of invalid) {
    await assert.rejects(() => sign(changes).then(token => verifyMicrosoftIdentityToken(token, 'our-client', 'server-nonce', resolver)))
  }
  for (const field of ['sub', 'iat', 'nbf', 'exp', 'nonce', 'tid', 'ver']) {
    await assert.rejects(() => sign({ [field]: undefined }).then(token => verifyMicrosoftIdentityToken(token, 'our-client', 'server-nonce', resolver)))
  }
  await assert.rejects(() => sign({}, foreign.privateKey).then(token => verifyMicrosoftIdentityToken(token, 'our-client', 'server-nonce', resolver)))
  await assert.rejects(() => verifyMicrosoftIdentityToken('not-a-jwt', 'our-client', 'server-nonce', resolver))
  const rsa = await generateKeyPair('PS256')
  await assert.rejects(() => sign({}, rsa.privateKey, { alg: 'PS256' }).then(token => verifyMicrosoftIdentityToken(token, 'our-client', 'server-nonce', resolver)))
})

test('a valid signature from a key scoped to another issuer or without issuer metadata is rejected', async () => {
  const token = await sign()
  for (const issuer of [undefined, 'https://attacker.example/v2.0', 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0']) {
    // Explicit undefined must not select the factory default.
    const resolver = createMicrosoftKeySet(async () => Response.json({ keys: [{ ...jwk, issuer }] }))
    await assert.rejects(() => verifyMicrosoftIdentityToken(token, 'our-client', 'server-nonce', resolver))
  }
  const unavailable = createMicrosoftKeySet(async () => new Response('', { status: 503 }))
  await assert.rejects(() => verifyMicrosoftIdentityToken(token, 'our-client', 'server-nonce', unavailable))
})

test('Microsoft callback configuration is same-origin, exact-path and HTTPS except localhost', () => {
  assert.equal(microsoftRedirectUri('', 'http://localhost:3000'), 'http://localhost:3000/auth/callback-microsoft')
  assert.equal(microsoftRedirectUri('', 'https://demo.example'), 'https://demo.example/auth/callback-microsoft')
  for (const value of [
    'https://foreign.example/auth/callback-microsoft', 'https://demo.example/other',
    'https://demo.example/auth/callback-microsoft?code=anything', 'https://demo.example/auth/callback-microsoft#hash',
    'https://name:secret@demo.example/auth/callback-microsoft', 'not a URL'
  ]) assert.throws(() => microsoftRedirectUri(value, 'https://demo.example'))
  assert.throws(() => microsoftRedirectUri('', 'http://demo.example'))
})

test('Microsoft challenges are browser-bound, isolated from other providers, expire and cannot replay', () => {
  const store = new ChallengeStore()
  const { id } = store.create('microsoft', '', 1000)
  assert.throws(() => store.take('forged-cookie', 'microsoft', 1000))
  assert.throws(() => store.take(id, 'google', 1000))
  assert.equal(store.take(id, 'microsoft', 1000).provider, 'microsoft')
  assert.throws(() => store.take(id, 'microsoft', 1000))
  const expired = store.create('microsoft', '', 1000)
  assert.throws(() => store.take(expired.id, 'microsoft', 601000))
})

test('Microsoft identity permits missing email and never substitutes preferred_username', () => {
  assert.deepEqual(publicIdentity('microsoft', { sub: 'personal-user', preferred_username: 'not-an-email' }), {
    provider: 'microsoft', subject: 'personal-user', name: null, email: null, emailVerified: false
  })
  assert.equal(publicIdentity('microsoft', { sub: 'personal-user', email: 'alice@outlook.com' }).email, 'a***@outlook.com')
})
