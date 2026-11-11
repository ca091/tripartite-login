import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AuthIdentity, Provider } from '../../shared/types/auth'

export const challengeLifetime = 10 * 60 * 1000

export function sameSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' || !actual || !expected) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export interface AuthChallenge {
  provider: Provider
  nonce: string
  state: string
  verifier: string
  redirectUri: string
  expiresAt: number
}

// Deliberately temporary: this demo has no user database or persistent session.
// Multi-instance deployments must replace this store with shared, atomic storage.
export class ChallengeStore {
  private records = new Map<string, AuthChallenge>()

  create(provider: Provider, redirectUri: string, now = Date.now()) {
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(key)
    }
    if (this.records.size >= 1000) throw new Error('Too many pending sign-ins')
    const id = randomBytes(32).toString('base64url')
    const challenge: AuthChallenge = {
      provider,
      nonce: randomBytes(32).toString('base64url'),
      state: randomBytes(32).toString('base64url'),
      verifier: randomBytes(64).toString('base64url'),
      redirectUri,
      expiresAt: now + challengeLifetime
    }
    this.records.set(id, challenge)
    return { id, challenge }
  }

  discard(id: string) {
    this.records.delete(id)
  }

  take(id: string, provider: Provider, now = Date.now()): AuthChallenge {
    const record = this.records.get(id)
    if (!record || record.provider !== provider) throw new Error('Sign-in challenge missing')
    this.records.delete(id)
    if (record.expiresAt <= now) throw new Error('Sign-in challenge expired')
    return record
  }
}

export function maskEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const at = value.lastIndexOf('@')
  if (at < 1 || at === value.length - 1) return null
  return `${value[0]}***@${value.slice(at + 1)}`
}

export function publicIdentity(provider: Provider, claims: Record<string, unknown>): AuthIdentity {
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('Identity has no subject')
  return {
    provider,
    subject: claims.sub,
    name: typeof claims.name === 'string' ? claims.name : null,
    email: maskEmail(claims.email),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true'
  }
}
