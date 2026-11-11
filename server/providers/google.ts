import { bodyString, consumeChallenge, requireProviderConfig, requireSameOrigin } from '../utils/auth'
import { publicIdentity } from '../utils/auth-core'
import { verifyIdentityToken } from '../utils/auth-tokens'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  requireProviderConfig(event, 'google')
  const challenge = consumeChallenge(event, 'google')
  const body: unknown = await readBody(event)
  const credential = bodyString(body, 'credential')
  try {
    const payload = await verifyIdentityToken(credential, 'google', useRuntimeConfig(event).public.googleClientId, challenge.nonce)
    return publicIdentity('google', payload)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Google identity verification failed; start again' })
  }
})
