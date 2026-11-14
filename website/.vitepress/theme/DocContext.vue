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
    <span aria-hidden="true">/</span>
    <span>{{ group }}</span>
  </nav>
</template>
