<script setup lang="ts">
import type { AuthStart } from '~~/shared/types/auth'

const props = defineProps<{ configured: boolean }>()
const emit = defineEmits<{ started: [] }>()
const busy = ref(false)
const errorMessage = ref('')

async function login() {
  if (!props.configured || busy.value) return
  emit('started')
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<AuthStart>('/api/auth/github/start', { method: 'POST' })
    if (!result.authorizationUrl) throw new Error('Missing authorization URL')
    window.location.assign(result.authorizationUrl)
  } catch {
    errorMessage.value = 'GitHub 登录未能开始，请重试。'
    busy.value = false
  }
}
</script>

<template>
  <div class="login-control">
    <UButton :disabled="!configured" :loading="busy" color="neutral" variant="outline" block size="lg" @click="login">{{ configured ? '使用 GitHub 登录' : 'GitHub 登录（未配置）' }}</UButton>
    <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
