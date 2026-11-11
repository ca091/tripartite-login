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
    <UButton v-if="!configured" disabled color="neutral" variant="outline" block size="lg" class="provider-login-button">
      <img src="/auth-assets/apple.svg" alt="" width="18" height="18">
      Apple 登录（未配置）
    </UButton>
    <UButton v-else-if="ready" :loading="busy" color="neutral" variant="outline" block size="lg" class="provider-login-button" @click="login">
      <img src="/auth-assets/apple.svg" alt="" width="18" height="18">
      Sign in with Apple
    </UButton>
    <UButton v-else :loading="busy" color="neutral" variant="outline" block size="lg" class="provider-login-button" @click="emit('started'); prepare()">
      <img src="/auth-assets/apple.svg" alt="" width="18" height="18">
      重新准备 Apple 登录
    </UButton>
    <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
