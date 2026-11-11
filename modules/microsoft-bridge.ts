import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { defineNuxtModule } from 'nuxt/kit'

export default defineNuxtModule({
  meta: { name: 'microsoft-redirect-bridge' },
  setup(_options, nuxt) {
    // Nuxt clears buildDir while building the application. Keep generated
    // server assets outside it so Nitro can collect them afterwards.
    nuxt.hook('nitro:config', async (config) => {
      const dir = join(nuxt.options.rootDir, '.cache', 'microsoft-bridge')
      await mkdir(dir, { recursive: true })
      await build({
        stdin: {
          contents: 'import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge"; broadcastResponseToMainFrame().catch(() => { document.body.textContent = "Microsoft 登录未完成，请关闭此窗口并在原页面重试。"; });',
          resolveDir: nuxt.options.rootDir,
          sourcefile: 'microsoft-redirect-bridge.js'
        },
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        minify: true,
        outfile: join(dir, 'bridge.js')
      })
      config.serverAssets ||= []
      config.serverAssets.push({ baseName: 'microsoft-bridge', dir })
    })
  }
})
