import { noAuthCache } from '../../utils/auth'

export default defineEventHandler((event) => {
  noAuthCache(event)
  removeResponseHeader(event, 'Cross-Origin-Opener-Policy')
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Security-Policy', "default-src 'none'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'")
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Microsoft 登录中</title></head><body><p>正在完成 Microsoft 登录…</p><script type="module" src="/auth/microsoft-bridge.js"></script></body></html>'
})
