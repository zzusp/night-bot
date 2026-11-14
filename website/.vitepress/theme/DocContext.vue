<script setup>
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'

const { page, theme } = useData()
const group = computed(() => {
  const path = `/${page.value.relativePath.replace(/\.md$/, '')}`
  return (Array.isArray(theme.value.sidebar) ? theme.value.sidebar : [])
    .find(section => section.items?.some(item => item.link.replace(/\/$/, '/index') === path))?.text || '参考资料'
})
</script>

<template>
  <nav class="nb-doc-context" aria-label="文档位置">
    <a :href="withBase('/guide/getting-started.html')">文档</a>
    <span class="nb-context-separator" aria-hidden="true"></span>
    <span>{{ group }}</span>
    <svg class="nb-doc-emblem" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="94" height="94" rx="28" fill="var(--board-primary-soft)" />
      <path d="M65 59a25 25 0 0 1-28-34 25 25 0 1 0 28 34Z" fill="var(--board-primary)" />
      <path d="m67 23 2.4 6.6L76 32l-6.6 2.4L67 41l-2.4-6.6L58 32l6.6-2.4Z" fill="var(--board-info)" />
      <circle cx="73" cy="63" r="2" fill="var(--board-info)" />
    </svg>
  </nav>
</template>
