<script setup lang="ts">
import type { MatchingJob } from '../../shared/transfer-api'

defineProps<{
  matchingJob: MatchingJob
  pauseReasonMessage: string
  jobControlPending: boolean
}>()

const emit = defineEmits<{
  newTransfer: []
  control: [action: 'pause' | 'resume' | 'cancel']
}>()
</script>

<template>
        <section class="rounded-3xl border border-white/10 bg-white/[0.045] p-6 sm:p-8">
          <p class="text-sm font-bold uppercase tracking-[0.18em] text-[#1db954]">Перенос</p>
          <h2 class="mt-3 text-3xl font-black">{{ matchingJob.name }}</h2>
          <p v-if="matchingJob.state === 'transferring'" class="mt-5 text-white/65">Spotify создает плейлист и добавляет треки.</p>
          <p v-if="matchingJob.state === 'verifying'" class="mt-5 text-white/65">Сервис проверяет порядок треков в Spotify.</p>
          <p v-if="matchingJob.state === 'completed'" class="mt-5 text-[#9ee6b4]">Перенос завершен. Порядок треков подтвержден.</p>
          <p v-if="matchingJob.state === 'failed'" class="mt-5 text-red-300">Перенос завершился с ошибкой. Скачайте отчет для проверки.</p>
          <p v-if="matchingJob.state === 'cancelled'" class="mt-5 text-white/60">Задание отменено. Сервис не удалил данные из Spotify.</p>
          <p v-if="matchingJob.state === 'paused'" role="alert" class="mt-5 text-red-300">Задание приостановлено. {{ pauseReasonMessage }}</p>
          <div v-if="['transferring', 'verifying'].includes(matchingJob.state)" class="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
            <div class="h-full w-2/3 animate-pulse rounded-full bg-[#1db954]" />
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <a v-if="matchingJob.state === 'completed' && matchingJob.spotifyId" :href="`https://open.spotify.com/playlist/${matchingJob.spotifyId}`" target="_blank" rel="noreferrer" class="inline-flex min-h-11 items-center rounded-xl bg-[#1db954] px-5 font-bold text-black">Открыть плейлист в Spotify</a>
            <template v-if="['completed', 'failed', 'cancelled'].includes(matchingJob.state)">
              <a :href="`/api/jobs/${matchingJob.id}/report?format=json`" class="inline-flex min-h-11 items-center rounded-xl border border-white/15 px-5 font-bold">Скачать JSON</a>
              <a :href="`/api/jobs/${matchingJob.id}/report?format=csv`" class="inline-flex min-h-11 items-center rounded-xl border border-white/15 px-5 font-bold">Скачать CSV</a>
              <button type="button" class="min-h-11 rounded-xl bg-[#ffcc00] px-5 font-bold text-black" @click="emit('newTransfer')">Новый перенос</button>
            </template>
            <button v-if="['transferring', 'verifying'].includes(matchingJob.state)" type="button" :disabled="jobControlPending" class="min-h-11 rounded-xl border border-white/15 px-5 font-bold disabled:opacity-40" @click="emit('control', 'pause')">Приостановить</button>
            <button v-if="matchingJob.state === 'paused'" type="button" :disabled="jobControlPending" class="min-h-11 rounded-xl bg-[#ffcc00] px-5 font-bold text-black disabled:opacity-40" @click="emit('control', 'resume')">Продолжить</button>
          </div>
        </section>
</template>
