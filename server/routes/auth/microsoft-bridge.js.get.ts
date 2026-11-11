import { noAuthCache } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  noAuthCache(event)
  setHeader(event, 'Content-Type', 'text/javascript; charset=utf-8')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  const script = await useStorage('assets:microsoft-bridge').getItem<string>('bridge.js')
  if (!script) throw createError({ statusCode: 503, statusMessage: 'Microsoft redirect bridge is unavailable' })
  return script
})
