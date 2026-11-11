<script setup lang="ts">
import type { AuthIdentity, AuthStart } from '~~/shared/types/auth'
import { loadAppleSDK } from '~/utils/apple-sdk'

const props = defineProps<{ configured: boolean }>()
const emit = defineEmits<{ started: [], verified: [identity: AuthIdentity] }>()
const config = useRuntimeConfig()
const busy = ref(false)
const ready = ref(false)
const errorMessage = ref('')

async function prepare() {
  if (!props.configured || busy.value) return
  busy.value = true
  ready.value = false
  errorMessage.value = ''
  try {
    const sdk = await loadAppleSDK()
    const challenge = await $fetch<AuthStart>('/api/auth/apple/start', { method: 'POST' })
    sdk.auth.init({
      clientId: config.public.appleClientId,
      redirectURI: config.public.appleRedirectUri,
      scope: 'name email',
      state: challenge.state,
      nonce: challenge.nonce,
      usePopup: true
    })
    ready.value = true
  } catch {
    errorMessage.value = 'Apple 登录初始化失败，请重试。'
  } finally { busy.value = false }
}

async function login() {
  if (!ready.value || busy.value) return
  emit('started')
  busy.value = true
  errorMessage.value = ''
  try {
    // Open the popup directly from the click; SDK/challenge were prepared earlier.
    const result = await window.AppleID!.auth.signIn()
    const identity = await $fetch<AuthIdentity>('/api/auth/apple/verify', {
      method: 'POST', body: { code: result.authorization.code, state: result.authorization.state }
    })
    emit('verified', identity)
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'error' in error ? error.error : undefined
    errorMessage.value = code === 'popup_closed_by_user' || code === 'user_cancelled_authorize'
      ? '已取消 Apple 登录，可以重新开始。'
      : 'Apple 登录未完成，请检查配置后重试。'
    await $fetch('/api/auth/apple/cancel', { method: 'POST' }).catch(() => {})
  } finally {
    busy.value = false
    ready.value = false
  }
}

onMounted(() => { void prepare() })
</script>

<template>
  <div class="login-control">
    <UButton v-if="!configured" disabled color="neutral" variant="outline" block size="lg">Apple 登录（未配置）</UButton>
    <UButton v-else-if="ready" :loading="busy" color="neutral" block size="lg" @click="login">
      <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="currentColor"><path d="M17.05 12.54c.03 3.23 2.84 4.3 2.87 4.32-.02.08-.45 1.54-1.48 3.05-.9 1.3-1.83 2.6-3.3 2.63-1.45.04-1.92-.85-3.58-.85-1.66 0-2.18.82-3.55.89-1.42.05-2.5-1.42-3.41-2.72C2.74 17.19 1.32 12.3 3.24 9c.95-1.65 2.65-2.69 4.49-2.71 1.4-.03 2.73.94 3.59.94.86 0 2.47-1.16 4.16-.99.7.03 2.65.28 3.9 2.11-.1.06-2.33 1.36-2.31 4.19ZM14.31 4.48c.75-.9 1.25-2.15 1.11-3.4-1.08.04-2.39.72-3.17 1.62-.69.8-1.29 2.08-1.12 3.3 1.21.09 2.44-.62 3.18-1.52Z" /></svg>
      Sign in with Apple
    </UButton>
    <UButton v-else :loading="busy" color="neutral" variant="outline" block size="lg" @click="emit('started'); prepare()">重新准备 Apple 登录</UButton>
    <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
