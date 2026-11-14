<script setup>
import { onMounted, onUnmounted } from 'vue'
import DefaultTheme from 'vitepress/theme-without-fonts'
import Home from './Home.vue'
import DocContext from './DocContext.vue'

// VitePress 1.x focuses its async search input before the focus trap captures
// the opener. Restore the stable trigger only after an explicit dismissal,
// never after choosing a search result or while a newer search is open.
let frame = 0
function returnSearchFocus() {
  const trigger = document.querySelector('#local-search button')
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (!document.querySelector('.VPLocalSearchBox')) trigger?.focus({ preventScroll: true })
  })
}
function onKeydown(event) {
  if (event.key === 'Escape' && document.querySelector('.VPLocalSearchBox')) returnSearchFocus()
}
function onClick(event) {
  if (event.target instanceof Element && event.target.closest('.VPLocalSearchBox .back-button, .VPLocalSearchBox .backdrop')) returnSearchFocus()
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('click', onClick, true)
})
onUnmounted(() => {
  cancelAnimationFrame(frame)
  document.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('click', onClick, true)
})
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-before><Home /></template>
    <template #doc-before><DocContext /></template>
    <template #sidebar-nav-before><div class="nb-sidebar-label"><span>使用手册</span></div></template>
  </DefaultTheme.Layout>
</template>
