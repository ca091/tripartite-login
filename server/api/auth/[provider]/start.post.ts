import { authProvider, beginChallenge, requireProviderConfig, requireSameOrigin } from '../../../utils/auth'
import { pkceChallenge } from '../../../utils/auth-core'
import type { AuthStart } from '#shared/types/auth.ts'

export default defineEventHandler((event): AuthStart => {
  requireSameOrigin(event)
  const provider = authProvider(getRouterParam(event, 'provider'))
  const status = requireProviderConfig(event, provider)
  const challenge = beginChallenge(event, provider, status.redirectUri || '')
  const result: AuthStart = { nonce: challenge.nonce, state: challenge.state }
  if (provider === 'github') {
    const config = useRuntimeConfig(event)
    const params = new URLSearchParams({
      client_id: config.public.githubClientId,
      redirect_uri: challenge.redirectUri,
      scope: 'read:user user:email',
      state: challenge.state,
      code_challenge: pkceChallenge(challenge.verifier),
      code_challenge_method: 'S256'
    })
    result.authorizationUrl = `https://github.com/login/oauth/authorize?${params}`
  }
  return result
})
