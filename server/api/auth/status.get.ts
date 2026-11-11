import { providers } from '#shared/types/auth.ts'
import { noAuthCache, providerStatus } from '../../utils/auth'

export default defineEventHandler((event) => {
  noAuthCache(event)
  return providers.map(provider => providerStatus(event, provider))
})
