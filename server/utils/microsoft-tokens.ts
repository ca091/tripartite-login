import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import { microsoftAuthority, microsoftIssuer, microsoftTenant } from '../../shared/microsoft.ts'
import { sameSecret } from './auth-core.ts'

// Filter Microsoft-specific key issuer metadata before jose caches/selects keys.
// Neither the JWKS URL nor the allowed issuer is derived from an unverified JWT.
export function createMicrosoftKeySet(fetcher: typeof fetch = fetch) {
  return createRemoteJWKSet(new URL(`${microsoftAuthority}/discovery/v2.0/keys`), {
    [customFetch]: async (url, options) => {
      const response = await fetcher(url, options)
      if (response.status !== 200) return response
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || !('keys' in body) || !Array.isArray(body.keys)) throw new Error('Invalid Microsoft JWKS')
      const keys = body.keys.filter((key: unknown) => {
        if (!key || typeof key !== 'object' || !('issuer' in key)) return false
        return key.issuer === microsoftIssuer || key.issuer === 'https://login.microsoftonline.com/{tenantid}/v2.0'
      })
      return Response.json({ keys })
    }
  })
}

const microsoftKeys = createMicrosoftKeySet()

export async function verifyMicrosoftIdentityToken(token: string, audience: string, nonce: string, keys: JWTVerifyGetKey = microsoftKeys) {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'],
    issuer: microsoftIssuer,
    audience,
    requiredClaims: ['sub', 'iat', 'nbf', 'exp', 'nonce', 'tid', 'ver']
  })
  if (payload.tid !== microsoftTenant || payload.ver !== '2.0' || typeof payload.sub !== 'string' || !payload.sub || !sameSecret(payload.nonce, nonce)) {
    throw new Error('Invalid Microsoft identity claims')
  }
  return payload
}
