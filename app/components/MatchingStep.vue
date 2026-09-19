<script setup lang="ts">
import type { MatchingJob } from '../../shared/transfer-api'

defineProps<{
  matchingJob: MatchingJob
  quotaResetText: string
  pauseReasonMessage: string
  jobControlPending: boolean
}>()

const emit = defineEmits<{
  back: []
  openConfirmation: []
  control: [action: 'pause' | 'resume' | 'cancel']
}>()
</script>

<template>
        <section class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
          <button
            type="button"
            class="mb-5 min-h-10 rounded-lg border border-white/15 px-4 text-sm font-bold text-white/75"
            @click="emit('back')"
          >
            ← Назад к выбору
          </button>
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-semibold text-white/55">Поиск совпадений</p>
              <h3 class="mt-1 text-xl font-bold">{{ matchingJob.name }}</h3>
            </div>
            <span class="text-sm font-bold text-[#ffdc59]">{{ matchingJob.processed }} из {{ matchingJob.total }}</span>
          </div>
          <div class="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              class="h-full rounded-full bg-[#ffcc00] transition-all"
              :style="{ width: `${matchingJob.total ? matchingJob.processed / matchingJob.total * 100 : 100}%` }"
            />
          </div>
          <p
            v-if="matchingJob.pauseReason === 'SPOTIFY_QUOTA_EXCEEDED' && quotaResetText"
            role="status"
            class="mt-4 text-sm text-[#ffdc59]"
          >
            Spotify исчерпал квоту. Поиск продолжится автоматически {{ quotaResetText }}.
          </p>
          <p v-if="matchingJob.state === 'review_required'" class="mt-4 text-sm text-white/65">
            Поиск завершен. Точных совпадений: {{ matchingJob.accepted }}. Требуют проверки: {{ matchingJob.reviewRequired }}. Не найдены: {{ matchingJob.unavailable }}.
          </p>
          <p v-if="matchingJob.state === 'ready'" class="mt-4 text-sm text-[#9ee6b4]">
            Все решения сохранены. План переноса готов к подтверждению.
          </p>
          <div v-if="matchingJob.state === 'ready'" class="mt-4 rounded-xl border border-[#ffcc00]/25 bg-[#ffcc00]/7 p-4">
            <p class="text-sm text-white/65">
              Совпадения готовы. Выбрано: {{ matchingJob.accepted }}. Исключено: {{ matchingJob.excluded }}.
            </p>
            <button
              type="button"
              class="mt-4 min-h-11 rounded-xl bg-[#ffcc00] px-5 font-extrabold text-black"
              @click="emit('openConfirmation')"
            >
              Перейти к подтверждению
            </button>
          </div>
          <p v-if="matchingJob.state === 'transferring'" class="mt-4 text-sm text-white/65">
            Spotify создает плейлист и добавляет треки.
          </p>
          <p v-if="matchingJob.state === 'verifying'" class="mt-4 text-sm text-white/65">
            Сервис проверяет порядок треков в Spotify.
          </p>
          <div v-if="matchingJob.state === 'completed' && matchingJob.spotifyId" class="mt-4">
            <p class="text-sm text-[#9ee6b4]">Перенос завершен. Порядок треков подтвержден.</p>
            <a
              :href="`https://open.spotify.com/playlist/${matchingJob.spotifyId}`"
              target="_blank"
              rel="noreferrer"
              class="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[#1db954] px-4 text-sm font-bold text-black"
            >
              Открыть плейлист в Spotify
            </a>
          </div>
          <div v-if="['completed', 'failed', 'cancelled'].includes(matchingJob.state)" class="mt-4 flex flex-wrap gap-2">
            <a
              :href="`/api/jobs/${matchingJob.id}/report?format=json`"
              class="inline-flex min-h-10 items-center rounded-lg border border-white/15 px-4 text-sm font-bold text-white"
            >
              Скачать JSON
            </a>
            <a
              :href="`/api/jobs/${matchingJob.id}/report?format=csv`"
              class="inline-flex min-h-10 items-center rounded-lg border border-white/15 px-4 text-sm font-bold text-white"
            >
              Скачать CSV
            </a>
          </div>
          <p v-if="matchingJob.state === 'paused'" role="alert" class="mt-4 text-sm text-red-300">
            Задание приостановлено. {{ pauseReasonMessage }}
          </p>
          <a
            v-if="matchingJob.state === 'paused' && matchingJob.pauseReason === 'SPOTIFY_RECONNECT_REQUIRED'"
            href="/api/auth/spotify/start"
            class="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[#1db954] px-4 text-sm font-bold text-black"
          >
            Повторно подключить Spotify
          </a>
          <p v-if="matchingJob.state === 'cancelled'" class="mt-4 text-sm text-white/60">
            Задание отменено. Сервис не удалил созданные данные в Spotify.
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              v-if="['queued', 'matching', 'transferring', 'verifying'].includes(matchingJob.state)"
              type="button"
              :disabled="jobControlPending"
              class="min-h-10 rounded-lg border border-white/15 px-4 text-sm font-bold text-white disabled:opacity-40"
              @click="emit('control', 'pause')"
            >
              Приостановить
            </button>
            <button
              v-if="matchingJob.state === 'paused'"
              type="button"
              :disabled="jobControlPending"
              class="min-h-10 rounded-lg bg-[#ffcc00] px-4 text-sm font-bold text-black disabled:opacity-40"
              @click="emit('control', 'resume')"
            >
              Продолжить
            </button>
            <button
              v-if="!['completed', 'failed', 'cancelled'].includes(matchingJob.state)"
              type="button"
              :disabled="jobControlPending"
              class="min-h-10 rounded-lg border border-red-400/35 px-4 text-sm font-bold text-red-200 disabled:opacity-40"
              @click="emit('control', 'cancel')"
            >
              Отменить задание
            </button>
          </div>
        </section>
</template>
