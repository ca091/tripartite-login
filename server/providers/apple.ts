import { bodyString, consumeChallenge, requireProviderConfig, requireSameOrigin } from '../utils/auth'
import { publicIdentity, sameSecret } from '../utils/auth-core'
import { createAppleClientSecret, verifyIdentityToken } from '../utils/auth-tokens'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  requireProviderConfig(event, 'apple')
  const challenge = consumeChallenge(event, 'apple')
  const body: unknown = await readBody(event)
  const code = bodyString(body, 'code')
  if (!sameSecret(bodyString(body, 'state'), challenge.state)) {
    throw createError({ statusCode: 400, statusMessage: 'Apple sign-in state does not match; start again' })
  }
  const config = useRuntimeConfig(event)
  try {
    const clientSecret = await createAppleClientSecret(config)
    const tokens = await $fetch<{ id_token?: string }>('https://appleid.apple.com/auth/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.public.appleClientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: challenge.redirectUri
      }),
      timeout: 15000,
      retry: 0
    })
    if (!tokens.id_token) throw new Error('No identity token')
    const payload = await verifyIdentityToken(tokens.id_token, 'apple', config.public.appleClientId, challenge.nonce)
    // Apple name is a first-authorization-only, unsigned browser field.
    // This demo only returns the identity claims verified from Apple's token.
    return publicIdentity('apple', payload)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Apple identity verification failed; check application configuration and retry' })
  }
})
