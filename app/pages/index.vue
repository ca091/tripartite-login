<script setup lang="ts">
useHead({ title: '三方登录', htmlAttrs: { lang: 'zh-CN' } })
</script>

<template>
  <div>
    <header class="login-heading">
      <h1>三方登录</h1>
      <NuxtLink to="/docs/auth/README.md" target="_blank" class="doc-link">接入说明</NuxtLink>
    </header>
    <client-only>
      <AuthLoginCollection />
    </client-only>
  </div>
</template>
