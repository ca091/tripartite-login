<script setup lang="ts">
import type { AuthIdentity } from '~~/shared/types/auth'

useHead({ title: 'GitHub 登录', meta: [{ name: 'referrer', content: 'no-referrer' }] })
const route = useRoute()
const result = useAuthResult()

onMounted(async () => {
  const { code, state, error } = route.query
  // Remove authorization codes before any requests or navigation.
  window.history.replaceState(window.history.state, '', route.path)
  result.value = { identity: null, message: '' }
  if (error || typeof code !== 'string' || typeof state !== 'string' || !code || !state) {
    await $fetch('/api/auth/github/cancel', { method: 'POST' }).catch(() => {})
    result.value.message = error === 'access_denied' ? '已取消 GitHub 登录，可以重试。' : 'GitHub 回调参数不完整，请重新登录。'
  } else {
    try {
      result.value.identity = await $fetch<AuthIdentity>('/api/auth/github/verify', { method: 'POST', body: { code, state } })
    } catch {
      result.value.message = 'GitHub 身份验证失败或已过期，请重新登录。'
    }
  }
  await navigateTo('/', { replace: true })
})
</script>

<template>
  <p class="muted-copy" role="status">正在验证 GitHub 身份…</p>
</template>
