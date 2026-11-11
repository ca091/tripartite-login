import { bodyString, consumeChallenge, requireProviderConfig, requireSameOrigin } from '../utils/auth'
import { publicIdentity, sameSecret } from '../utils/auth-core'

interface GithubUser {
  id: number
  login: string
  name: string | null
}
interface GithubEmail { email: string, primary: boolean, verified: boolean }

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  requireProviderConfig(event, 'github')
  const challenge = consumeChallenge(event, 'github')
  const body: unknown = await readBody(event)
  const code = bodyString(body, 'code')
  if (!sameSecret(bodyString(body, 'state'), challenge.state)) {
    throw createError({ statusCode: 400, statusMessage: 'GitHub sign-in state does not match; start again' })
  }
  const config = useRuntimeConfig(event)
  try {
    const tokens = await $fetch<{ access_token?: string, error?: string }>('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: {
        client_id: config.public.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        code_verifier: challenge.verifier,
        redirect_uri: challenge.redirectUri
      },
      timeout: 15000,
      retry: 0
    })
    if (!tokens.access_token || tokens.error) throw new Error('No access token')
    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'tripartite-login-demo',
      'X-GitHub-Api-Version': '2022-11-28'
    }
    const user = await $fetch<GithubUser>('https://api.github.com/user', { headers, timeout: 15000, retry: 0 })
    if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Invalid user')
    // Email is optional: absent scope/hidden email must not fail identity verification.
    const emails = await $fetch<GithubEmail[]>('https://api.github.com/user/emails', { headers, timeout: 10000, retry: 0 }).catch(() => [])
    const email = emails.find(item => item.primary && item.verified) ?? emails.find(item => item.verified)
    return publicIdentity('github', {
      sub: String(user.id), name: user.name || user.login, email: email?.email, email_verified: Boolean(email)
    })
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'GitHub identity verification failed; check callback configuration and retry' })
  }
})
