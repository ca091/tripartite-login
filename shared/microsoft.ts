// Personal Microsoft accounts only; consumers is an authority, not a token issuer.
export const microsoftTenant = '9188040d-6c67-4c5b-b112-36a304b66dad'
export const microsoftAuthority = 'https://login.microsoftonline.com/consumers'
export const microsoftIssuer = `https://login.microsoftonline.com/${microsoftTenant}/v2.0`
export const microsoftCallbackPath = '/auth/callback-microsoft'

export function microsoftRedirectUri(configured: string, origin: string): string {
  const expected = new URL(microsoftCallbackPath, origin)
  const actual = new URL(configured || expected.href)
  if (actual.href !== expected.href || (actual.protocol !== 'https:' && !(actual.protocol === 'http:' && actual.hostname === 'localhost'))) {
    throw new Error('Microsoft redirect must be the same-origin callback, using HTTPS or localhost HTTP')
  }
  return actual.href
}
