import type { AuthIdentity } from '~~/shared/types/auth'

// Shared only across client navigation, including the GitHub callback. No persistence.
export function useAuthResult() {
  return useState<{ identity: AuthIdentity | null, message: string }>('auth-result', () => ({
    identity: null,
    message: ''
  }))
}
