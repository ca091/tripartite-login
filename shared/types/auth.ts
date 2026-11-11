export const providers = ['google', 'apple', 'github'] as const
export type Provider = typeof providers[number]

export interface AuthIdentity {
  provider: Provider
  subject: string
  name: string | null
  email: string | null
  emailVerified: boolean
}

export interface ProviderStatus {
  provider: Provider
  configured: boolean
  missing: string[]
  redirectUri: string | null
}

export interface AuthStart {
  nonce: string
  state: string
  authorizationUrl?: string
}
