<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { IPublicClientApplication } from '@azure/msal-browser'
import type { AuthIdentity, AuthStart } from '~~/shared/types/auth'
import { microsoftRedirectUri } from '~~/shared/microsoft'
import { createMicrosoftClient } from '~/utils/microsoft-sdk'

const props = defineProps<{ configured: boolean }>()
const emit = defineEmits<{ started: [], verified: [identity: AuthIdentity] }>()
const config = useRuntimeConfig()
const busy = ref(false)
const challenge = ref<AuthStart | null>(null)
const errorMessage = ref('')
let client: IPublicClientApplication | undefined
let redirectUri = ''
let mounted = false
let generation = 0

async function prepare() {
  if (!mounted || !props.configured || busy.value) return
  const attempt = ++generation
  busy.value = true
  challenge.value = null
  errorMessage.value = ''
  try {
    redirectUri = microsoftRedirectUri(config.public.microsoftRedirectUri, window.location.origin)
    const initialized = client ?? await createMicrosoftClient(config.public.microsoftClientId, redirectUri)
    if (!mounted || attempt !== generation) {
      await initialized.clearCache().catch(() => {})
      return
    }
    client = initialized
    const started = await $fetch<AuthStart>('/api/auth/microsoft/start', { method: 'POST' })
    if (mounted && attempt === generation) challenge.value = started
  } catch {
    if (mounted && attempt === generation) errorMessage.value = 'Microsoft 登录初始化失败，请重新准备。'
  } finally {
    if (!mounted) await client?.clearCache().catch(() => {})
    if (mounted && attempt === generation) busy.value = false
  }
}

async function login() {
  if (!mounted || busy.value || !client || !challenge.value) return
  const attempt = ++generation
  const nonce = challenge.value.nonce
  const activeClient = client
  busy.value = true
  challenge.value = null
  errorMessage.value = ''
  emit('started')
  let verifying = false
  try {
    // SDK initialization and the server challenge are ready before the click.
    const response = await activeClient.loginPopup({
      scopes: ['openid', 'profile', 'email'],
      nonce,
      prompt: 'select_account',
      redirectUri
    })
    if (!mounted || attempt !== generation) return
    if (!response.idToken) throw new Error('Missing Microsoft ID token')
    verifying = true
    const identity = await $fetch<AuthIdentity>('/api/auth/microsoft/verify', {
      method: 'POST', body: { credential: response.idToken }
    })
    if (mounted && attempt === generation) emit('verified', identity)
  } catch (error: unknown) {
    if (!mounted || attempt !== generation) return
    const code = error && typeof error === 'object' && 'errorCode' in error ? error.errorCode : undefined
    errorMessage.value = verifying
      ? 'Microsoft 身份验证失败或已过期，请重新准备。'
      : code === 'user_cancelled'
        ? '已取消 Microsoft 登录，请重新准备。'
        : code === 'popup_window_error' || code === 'empty_window_error'
          ? '浏览器未能打开 Microsoft 登录窗口，请允许弹窗后重新准备。'
          : code === 'timed_out'
            ? 'Microsoft 登录已超时或窗口已关闭，请重新准备。'
            : 'Microsoft 登录未完成，请重新准备。'
    await $fetch('/api/auth/microsoft/cancel', { method: 'POST' }).catch(() => {})
  } finally {
    // Clear local SDK tokens without signing the user out of Microsoft.
    await activeClient.clearCache().catch(() => {})
    if (mounted && attempt === generation) busy.value = false
  }
}

onMounted(() => { mounted = true; void prepare() })
onBeforeUnmount(() => {
  mounted = false
  generation++
  if (!busy.value) void client?.clearCache().catch(() => {})
})
</script>

<template>
  <div class="login-control">
    <UButton v-if="!configured" disabled color="neutral" variant="outline" block size="lg" class="provider-login-button">
      <img src="/auth-assets/microsoft.svg" alt="" width="18" height="18">
      Microsoft 登录（未配置）
    </UButton>
    <button v-else-if="challenge" type="button" class="provider-login-button microsoft-login-button" @click="login">
      <img src="/auth-assets/microsoft.svg" alt="" width="18" height="18">
      Sign in with Microsoft
    </button>
    <UButton v-else :loading="busy" color="neutral" variant="outline" block size="lg" class="provider-login-button" @click="emit('started'); prepare()">
      <img src="/auth-assets/microsoft.svg" alt="" width="18" height="18">
      重新准备 Microsoft 登录
    </UButton>
    <p v-if="busy" class="muted-copy" role="status">正在准备或完成 Microsoft 登录；关闭弹窗后可能需要等待超时。</p>
    <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
