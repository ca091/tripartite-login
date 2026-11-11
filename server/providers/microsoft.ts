import { bodyString, consumeChallenge, requireProviderConfig, requireSameOrigin } from '../utils/auth'
import { publicIdentity } from '../utils/auth-core'
import { verifyMicrosoftIdentityToken } from '../utils/microsoft-tokens'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  requireProviderConfig(event, 'microsoft')
  const challenge = consumeChallenge(event, 'microsoft')
  const body: unknown = await readBody(event)
  const credential = bodyString(body, 'credential')
  try {
    const claims = await verifyMicrosoftIdentityToken(credential, useRuntimeConfig(event).public.microsoftClientId, challenge.nonce)
    // Microsoft does not provide a dependable email_verified assertion.
    return publicIdentity('microsoft', { sub: claims.sub, name: claims.name, email: claims.email, email_verified: false })
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Microsoft identity verification failed; start again' })
  }
})
