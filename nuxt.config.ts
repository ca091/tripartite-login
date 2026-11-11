import { fileURLToPath } from 'node:url'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'light' },
  nitro: {
    serverAssets: [{ baseName: 'auth-docs', dir: fileURLToPath(new URL('./docs/auth', import.meta.url)) }]
  },
  runtimeConfig: {
    githubClientSecret: '',
    appleTeamId: '',
    appleKeyId: '',
    applePrivateKey: '',
    public: {
      googleClientId: '',
      googleOneTapEnabled: false,
      githubClientId: '',
      githubRedirectUri: '',
      appleClientId: '',
      appleRedirectUri: ''
    }
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: {
    port: 3000,
  },
})
