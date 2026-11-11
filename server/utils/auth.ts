import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, getHeader, getRequestURL, setCookie, setResponseHeader } from 'h3'
import { useRuntimeConfig } from '#imports'
import { providers } from '#shared/types/auth.ts'
import type { Provider, ProviderStatus } from '#shared/types/auth.ts'
import { ChallengeStore } from './auth-core'
import { microsoftRedirectUri } from '#shared/microsoft.ts'

const challenges = new ChallengeStore()
const cookieName = (provider: Provider) => `oauth_demo_${provider}`

export function authProvider(value: unknown): Provider {
  if (!providers.includes(value as Provider)) throw createError({ statusCode: 404, statusMessage: 'Unknown provider' })
  return value as Provider
}

export function noAuthCache(event: H3Event) {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
}

export function requireSameOrigin(event: H3Event) {
  noAuthCache(event)
  const origin = getHeader(event, 'origin')
  if (!origin || origin !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, statusMessage: 'Sign-in requests must come from this site' })
  }
}

export function providerStatus(event: H3Event, provider: Provider): ProviderStatus {
  const config = useRuntimeConfig(event)
  const missing: string[] = []
  const needed = (value: unknown, name: string) => { if (!value) missing.push(name) }
  let redirectUri: string | null = null
  if (provider === 'google') needed(config.public.googleClientId, 'NUXT_PUBLIC_GOOGLE_CLIENT_ID')
  if (provider === 'github') {
    needed(config.public.githubClientId, 'NUXT_PUBLIC_GITHUB_CLIENT_ID')
    needed(config.githubClientSecret, 'NUXT_GITHUB_CLIENT_SECRET')
    // Source component also derived its callback from the current origin.
    redirectUri = config.public.githubRedirectUri || `${getRequestURL(event).origin}/auth/callback-github`
  }
  if (provider === 'apple') {
    needed(config.public.appleClientId, 'NUXT_PUBLIC_APPLE_CLIENT_ID')
    needed(config.public.appleRedirectUri, 'NUXT_PUBLIC_APPLE_REDIRECT_URI')
    needed(config.appleTeamId, 'NUXT_APPLE_TEAM_ID')
    needed(config.appleKeyId, 'NUXT_APPLE_KEY_ID')
    needed(config.applePrivateKey, 'NUXT_APPLE_PRIVATE_KEY')
    redirectUri = config.public.appleRedirectUri || null
  }
  if (provider === 'microsoft') {
    needed(config.public.microsoftClientId, 'NUXT_PUBLIC_MICROSOFT_CLIENT_ID')
    try {
      redirectUri = microsoftRedirectUri(config.public.microsoftRedirectUri, getRequestURL(event).origin)
    } catch {
      missing.push('NUXT_PUBLIC_MICROSOFT_REDIRECT_URI（同源 HTTPS 或 localhost 回调）')
    }
  }
  if (redirectUri) {
    try {
      const url = new URL(redirectUri)
      if (!['http:', 'https:'].includes(url.protocol) || url.hash || url.username || url.password) throw new Error('Invalid URL')
      if (provider === 'apple' && (url.protocol !== 'https:' || url.hostname === 'localhost' || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname))) throw new Error('Invalid Apple URL')
    } catch {
      missing.push(provider === 'apple' ? 'NUXT_PUBLIC_APPLE_REDIRECT_URI（有效 HTTPS 域名）' : 'NUXT_PUBLIC_GITHUB_REDIRECT_URI（有效 URL）')
    }
  }
  return { provider, configured: missing.length === 0, missing, redirectUri }
}

export function requireProviderConfig(event: H3Event, provider: Provider) {
  const status = providerStatus(event, provider)
  if (!status.configured) throw createError({ statusCode: 503, statusMessage: 'Provider configuration is incomplete', data: { missing: status.missing } })
  return status
}

export function beginChallenge(event: H3Event, provider: Provider, redirectUri: string) {
  const previous = getCookie(event, cookieName(provider))
  if (previous) challenges.discard(previous)
  let record: ReturnType<ChallengeStore['create']>
  try { record = challenges.create(provider, redirectUri) } catch {
    throw createError({ statusCode: 429, statusMessage: 'Too many pending sign-ins; retry later' })
  }
  setCookie(event, cookieName(provider), record.id, {
    httpOnly: true,
    secure: getRequestURL(event).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 600
  })
  return record.challenge
}

export function consumeChallenge(event: H3Event, provider: Provider) {
  const id = getCookie(event, cookieName(provider)) || ''
  deleteCookie(event, cookieName(provider), { path: '/' })
  try { return challenges.take(id, provider) } catch {
    throw createError({ statusCode: 400, statusMessage: 'Sign-in expired or already used; start again' })
  }
}

export function bodyString(body: unknown, key: string): string {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined
  if (typeof value !== 'string' || !value || value.length > 20000) {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${key}` })
  }
  return value
}
