<script setup lang="ts">
import type { AuthIdentity, Provider } from '~~/shared/types/auth'

const { data: statuses, error, status, refresh } = await useFetch('/api/auth/status', { key: 'auth-status' })
const result = useAuthResult()
const configured = (provider: Provider) => !!statuses.value?.find(item => item.provider === provider)?.configured

function resetResult() {
  result.value = { identity: null, message: '' }
}

function verified(identity: AuthIdentity) {
  result.value = { identity, message: '' }
}
</script>

<template>
  <section aria-label="选择登录方式">
    <div v-if="error" class="login-control">
      <UAlert color="error" description="配置读取失败，请重试。" role="alert" />
      <UButton color="neutral" variant="outline" block :loading="status === 'pending'" @click="refresh()">重试</UButton>
    </div>
    <template v-else-if="statuses">
      <div class="login-option">
        <AuthGoogleLogin :configured="configured('google')" @started="resetResult" @verified="verified" />
        <NuxtLink to="/docs/auth/google.md" target="_blank" class="doc-link" aria-label="Google 使用文档">Google 文档</NuxtLink>
      </div>
      <div class="login-option">
        <AuthAppleLogin :configured="configured('apple')" @started="resetResult" @verified="verified" />
        <NuxtLink to="/docs/auth/apple.md" target="_blank" class="doc-link" aria-label="Apple 使用文档">Apple 文档</NuxtLink>
      </div>
      <div class="login-option">
        <AuthGithubLogin :configured="configured('github')" @started="resetResult" />
        <NuxtLink to="/docs/auth/github.md" target="_blank" class="doc-link" aria-label="GitHub 使用文档">GitHub 文档</NuxtLink>
      </div>
      <div class="login-option">
        <AuthMicrosoftLogin :configured="configured('microsoft')" @started="resetResult" @verified="verified" />
        <NuxtLink to="/docs/auth/microsoft.md" target="_blank" class="doc-link" aria-label="Microsoft 使用文档">Microsoft 文档</NuxtLink>
      </div>
    </template>
    <p v-else class="muted-copy" role="status">正在加载…</p>

    <UAlert v-if="result.message" color="warning" :description="result.message" class="mt-6" role="alert" />
    <AuthIdentityResult v-if="result.identity" :identity="result.identity" />
  </section>
</template>
