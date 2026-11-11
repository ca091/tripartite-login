import { microsoftAuthority } from '~~/shared/microsoft'

export async function createMicrosoftClient(clientId: string, redirectUri: string) {
  const { BrowserCacheLocation, PublicClientApplication } = await import('@azure/msal-browser')
  const client = new PublicClientApplication({
    auth: { clientId, authority: microsoftAuthority, redirectUri },
    cache: { cacheLocation: BrowserCacheLocation.MemoryStorage }
  })
  await client.initialize()
  return client
}
