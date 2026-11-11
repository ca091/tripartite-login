import { authProvider, consumeChallenge, requireSameOrigin } from '../../../utils/auth'

export default defineEventHandler((event) => {
  requireSameOrigin(event)
  const provider = authProvider(getRouterParam(event, 'provider'))
  // Cancellation is idempotent, including expired/absent challenges.
  try { consumeChallenge(event, provider) } catch { /* Already cleared. */ }
  return { cancelled: true }
})
