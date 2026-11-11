import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import { sameSecret } from './auth-core.ts'

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))

export async function verifyIdentityToken(
  token: string,
  provider: 'google' | 'apple',
  audience: string,
  nonce: string,
  keys?: JWTVerifyGetKey
) {
  const issuer = provider === 'google'
    ? ['accounts.google.com', 'https://accounts.google.com']
    : 'https://appleid.apple.com'
  const { payload } = await jwtVerify(token, keys ?? (provider === 'google' ? googleKeys : appleKeys), {
    issuer,
    audience,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'iat', 'exp', 'nonce']
  })
  if (!sameSecret(payload.nonce, nonce)) throw new Error('Invalid nonce')
  return payload
}

export async function createAppleClientSecret(config: {
  applePrivateKey: string
  appleKeyId: string
  appleTeamId: string
  public: { appleClientId: string }
}) {
  const key = await importPKCS8(config.applePrivateKey.replace(/\\n/g, '\n'), 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.appleKeyId })
    .setIssuer(config.appleTeamId)
    .setSubject(config.public.appleClientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}
