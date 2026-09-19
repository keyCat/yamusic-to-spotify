<script setup lang="ts">
import type { MatchingJob } from '../../shared/transfer-api'

defineProps<{
  matchingJob: MatchingJob
  sourceCoverUrl: string | null
  confirmationPending: boolean
}>()

const emit = defineEmits<{
  back: []
  confirm: []
}>()
</script>

<template>
        <section class="rounded-3xl border border-white/10 bg-white/[0.045] p-6 sm:p-8">
          <p class="text-sm font-bold uppercase tracking-[0.18em] text-[#ffcc00]">Подтверждение</p>
          <h2 class="mt-3 text-3xl font-black">Проверьте план переноса</h2>
          <div class="mt-6 flex items-center gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <TrackCover :url="sourceCoverUrl" :alt="`Обложка Яндекс Музыки: ${matchingJob.name}`" provider="yandex" />
            <div>
              <h3 class="font-bold">{{ matchingJob.name }}</h3>
              <p class="mt-1 text-sm text-white/50">Новый приватный плейлист Spotify</p>
            </div>
          </div>
          <dl class="mt-6 grid gap-3 sm:grid-cols-3">
            <div class="rounded-xl border border-white/10 p-4"><dt class="text-sm text-white/45">Выбрано</dt><dd class="mt-1 text-2xl font-black">{{ matchingJob.accepted }}</dd></div>
            <div class="rounded-xl border border-white/10 p-4"><dt class="text-sm text-white/45">Исключено</dt><dd class="mt-1 text-2xl font-black">{{ matchingJob.excluded }}</dd></div>
            <div class="rounded-xl border border-white/10 p-4"><dt class="text-sm text-white/45">Доступ</dt><dd class="mt-1 font-bold">Приватный</dd></div>
          </dl>
          <div class="mt-7 flex flex-wrap gap-3">
            <button type="button" class="min-h-11 rounded-xl border border-white/15 px-5 font-bold" @click="emit('back')">Назад к совпадениям</button>
            <button type="button" :disabled="confirmationPending" class="min-h-11 rounded-xl bg-[#1db954] px-5 font-extrabold text-black disabled:opacity-60" @click="emit('confirm')">
              {{ confirmationPending ? 'Подтверждение…' : 'Создать приватный плейлист' }}
            </button>
          </div>
        </section>

</template>
