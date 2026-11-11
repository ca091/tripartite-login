<script setup lang="ts">
import type { AuthIdentity } from '~~/shared/types/auth'
defineProps<{ identity: AuthIdentity }>()
</script>

<template>
  <section class="identity-result" aria-live="polite">
    <p class="font-medium text-success">身份验证通过</p>
    <dl class="result-data">
      <dt>登录方式</dt><dd>{{ identity.provider }}</dd>
      <dt>用户标识</dt><dd>{{ identity.subject }}</dd>
      <dt>姓名</dt><dd>{{ identity.name || '平台未提供' }}</dd>
      <dt>邮箱</dt><dd>{{ identity.email || '平台未提供' }}</dd>
    </dl>
    <details :key="`${identity.provider}:${identity.subject}`" class="result-details">
      <summary>查看完整结果</summary>
      <pre>{{ JSON.stringify(identity, null, 2) }}</pre>
    </details>
  </section>
</template>
