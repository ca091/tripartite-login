import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ChallengeStore, challengeLifetime, pkceChallenge, publicIdentity, sameSecret } from '../server/utils/auth-core.ts'
import { verifyIdentityToken } from '../server/utils/auth-tokens.ts'

test('PKCE follows the RFC 7636 S256 example', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('challenge requires the browser cookie ID, correct provider and a single use', () => {
  const store = new ChallengeStore()
  const { id, challenge } = store.create('github', 'http://localhost/auth/callback-github')
  assert.throws(() => store.take('forged-cookie', 'github'))
  assert.throws(() => store.take(id, 'apple'))
  assert.equal(store.take(id, 'github'), challenge)
  assert.throws(() => store.take(id, 'github'))
})

test('expired and cancelled challenges cannot be consumed', () => {
  const store = new ChallengeStore()
  const expired = store.create('google', '', 1000)
  assert.throws(() => store.take(expired.id, 'google', 1000 + challengeLifetime))
  const cancelled = store.create('apple', '')
  store.discard(cancelled.id)
  assert.throws(() => store.take(cancelled.id, 'apple'))
})

test('nonce and state comparison rejects missing, forged and different-length values', () => {
  for (const value of [undefined, null, '', 123, 'abc', 'secret-longer']) assert.equal(sameSecret(value, 'secret'), false)
  assert.equal(sameSecret('secret', 'secret'), true)
})

test('identity response is a whitelist and masks email without returning tokens', () => {
  assert.deepEqual(publicIdentity('google', {
    sub: 'user-123', name: 'Alice', email: 'alice@example.com', email_verified: true,
    access_token: 'never-return-this', id_token: 'never-return-this', nonce: 'private-challenge'
  }), { provider: 'google', subject: 'user-123', name: 'Alice', email: 'a***@example.com', emailVerified: true })
  assert.equal(publicIdentity('apple', { sub: 'user-123' }).name, null)
  assert.equal(publicIdentity('github', { sub: '42' }).email, null)
  assert.throws(() => publicIdentity('google', { email: 'alice@example.com' }))
})

test('both providers reject wrong audience, issuer, nonce, expiry and signature', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const foreign = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] })
  for (const provider of ['google', 'apple']) {
    const issuer = provider === 'google' ? 'https://accounts.google.com' : 'https://appleid.apple.com'
    const sign = (changes = {}, key = privateKey) => new SignJWT({ nonce: 'expected', ...changes })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('verified-user').setIssuedAt().setExpirationTime('5m')
      .setIssuer(issuer).setAudience('our-client').sign(key)
    const token = await sign()
    assert.equal((await verifyIdentityToken(token, provider, 'our-client', 'expected', keys)).sub, 'verified-user')
    await assert.rejects(() => verifyIdentityToken(token, provider, 'other-client', 'expected', keys))
    await assert.rejects(() => verifyIdentityToken(token, provider === 'google' ? 'apple' : 'google', 'our-client', 'expected', keys))
    await assert.rejects(() => verifyIdentityToken(token, provider, 'our-client', 'other-nonce', keys))
    const forged = await sign({}, foreign.privateKey)
    await assert.rejects(() => verifyIdentityToken(forged, provider, 'our-client', 'expected', keys))
    const expired = await new SignJWT({ nonce: 'expected' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('verified-user').setIssuedAt(1).setExpirationTime(2).setIssuer(issuer).setAudience('our-client').sign(privateKey)
    await assert.rejects(() => verifyIdentityToken(expired, provider, 'our-client', 'expected', keys))
    const missingNonce = await sign({ nonce: undefined })
    await assert.rejects(() => verifyIdentityToken(missingNonce, provider, 'our-client', 'expected', keys))
  }
})
