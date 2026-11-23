<script setup>
defineProps({ name: { type: String, required: true } })

const paths = {
  arrow: 'M4.5 12h14m-5-5 5 5-5 5',
  external: 'M7 17 17 7M7 7h10v10',
  task: 'M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M8 12l3 3 8-9',
  memory: 'M12 5c-2-2-6-2-8-1v14c3-1 6-1 8 1 2-2 5-2 8-1V4c-2-1-6-1-8 1Zm0 0v14',
  time: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-4v4l3 2',
  channel: 'M20 11.5a6.5 6.5 0 0 1-6.5 6.5H8l-4 3v-9.5A6.5 6.5 0 0 1 10.5 5h3a6.5 6.5 0 0 1 6.5 6.5ZM8 10h8m-8 3h5',
  skill: 'm12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z',
  evolution: 'M20 9a8 8 0 1 0 0 6m0-11v5h-5m-6 5 3-3 3 3',
  continuation: 'M6 5v6a4 4 0 0 0 4 4h8m-4-4 4 4-4 4',
  check: 'm5 12 4 4L19 6'
}
</script>

<template>
  <svg class="nb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[name]" />
  </svg>
</template>
