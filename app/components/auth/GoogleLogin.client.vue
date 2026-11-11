<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { GoogleLogin } from 'vue3-google-login'
import type { AuthIdentity, AuthStart } from '~~/shared/types/auth'

type GoogleCredential = { credential?: string }
const props = defineProps<{ configured: boolean }>()
const emit = defineEmits<{ started: [], verified: [identity: AuthIdentity] }>()
const config = useRuntimeConfig()
const oneTapEnabled = String(config.public.googleOneTapEnabled) === 'true'
const busy = ref(false)
const errorMessage = ref('')
const challenge = ref<AuthStart | null>(null)
const callbacks = shallowRef<{ success: (response: GoogleCredential) => void, error: () => void }>()
const buttonContainer = ref<HTMLElement | null>(null)
const buttonWidth = ref(0)
let resizeObserver: ResizeObserver | undefined
let mounted = false
let generation = 0

async function prepare() {
  if (!mounted || !props.configured || busy.value) return
  const attempt = ++generation
  busy.value = true
  challenge.value = null
  errorMessage.value = ''
  try {
    const started = await $fetch<AuthStart>('/api/auth/google/start', { method: 'POST' })
    if (!mounted || attempt !== generation) return
    const active = () => mounted && attempt === generation && challenge.value?.nonce === started.nonce
    callbacks.value = {
      success: response => { if (active()) void verify(response) },
      error: () => {
        if (!active()) return
        generation++
        challenge.value = null
        emit('started')
        errorMessage.value = 'Google 登录未完成，请重新准备。'
      }
    }
    challenge.value = started
  } catch {
    if (mounted && attempt === generation) errorMessage.value = 'Google 登录初始化失败，请重试。'
  } finally {
    if (mounted && attempt === generation) busy.value = false
  }
}

async function verify(response: GoogleCredential) {
  if (!mounted || busy.value || !challenge.value) return
  const attempt = ++generation
  emit('started')
  challenge.value = null
  if (!response.credential) {
    errorMessage.value = 'Google 未返回身份凭证，请重新登录。'
    return
  }
  busy.value = true
  errorMessage.value = ''
  try {
    const identity = await $fetch<AuthIdentity>('/api/auth/google/verify', {
      method: 'POST', body: { credential: response.credential }
    })
    if (mounted && attempt === generation) emit('verified', identity)
  } catch {
    if (mounted && attempt === generation) errorMessage.value = 'Google 身份验证失败或已过期，请重新登录。'
  } finally {
    if (mounted && attempt === generation) busy.value = false
  }
}

onMounted(() => {
  mounted = true
  if (buttonContainer.value) {
    buttonWidth.value = Math.floor(buttonContainer.value.getBoundingClientRect().width)
    resizeObserver = new ResizeObserver(([entry]) => {
      if (mounted && entry) buttonWidth.value = Math.floor(entry.contentRect.width)
    })
    resizeObserver.observe(buttonContainer.value)
  }
  void prepare()
})
onBeforeUnmount(() => {
  mounted = false
  generation++
  resizeObserver?.disconnect()
})
</script>

<template>
  <div ref="buttonContainer" class="login-control min-w-0">
    <UButton v-if="!configured" disabled color="neutral" variant="outline" block size="lg">Google 登录（未配置）</UButton>
    <div v-else-if="challenge && callbacks && buttonWidth" class="min-h-10 min-w-0">
      <GoogleLogin
        :key="challenge.nonce"
        :client-id="config.public.googleClientId"
        :prompt="oneTapEnabled"
        :auto-login="false"
        :id-configuration="{ nonce: challenge.nonce, ux_mode: 'popup' }"
        :button-config="{
          theme: 'outline',
          size: 'large',
          width: String(buttonWidth),
          logo_alignment: 'center',
          click_listener: () => emit('started')
        }"
        :callback="callbacks.success"
        :error="callbacks.error"
      />
    </div>
    <UButton v-else :loading="busy" color="neutral" variant="outline" block size="lg" @click="emit('started'); prepare()">重新准备 Google 登录</UButton>
    <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
