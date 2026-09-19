<script setup lang="ts">
const props = defineProps<{
  url: string | null | undefined
  alt: string
  provider: 'yandex' | 'spotify'
  size?: 'sm' | 'md'
}>()

const failed = ref(false)
watch(() => props.url, () => { failed.value = false })
</script>

<template>
  <div
    class="grid shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10"
    :class="[
      size === 'sm' ? 'size-12' : 'size-16',
      provider === 'yandex' ? 'bg-[#ffcc00]/12 text-[#ffcc00]' : 'bg-[#1db954]/12 text-[#74df98]',
    ]"
  >
    <img
      v-if="url && !failed"
      :src="url"
      :alt="alt"
      class="size-full object-cover"
      loading="lazy"
      @error="failed = true"
    >
    <span v-else aria-hidden="true" class="text-lg font-black">{{ provider === 'yandex' ? 'Я' : 'S' }}</span>
  </div>
</template>
