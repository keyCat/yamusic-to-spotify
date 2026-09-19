<script setup lang="ts">
import type { ReviewDecision } from '../../shared/transfer-api'
import {
  candidateSelectionRequest,
  chooseCandidate,
  createCandidateSelection,
  matchDecisionLabel,
} from '../utils/transfer-wizard'

const props = defineProps<{
  decision: ReviewDecision
  requestPending: boolean
}>()

const emit = defineEmits<{
  confirm: [entryId: string, candidateUri: string]
  exclude: [entryId: string]
  search: [decision: ReviewDecision, query: string]
}>()

const expanded = ref(false)
const query = ref([props.decision.source.title, props.decision.source.artists[0]].filter(Boolean).join(' '))
const candidateSelection = ref(createCandidateSelection(props.decision.candidateUri))
const selectedCandidate = computed(() => props.decision.evidence.candidates.find(candidate => (
  candidate.uri === candidateSelection.value.draftUri
)) || null)
const needsReview = computed(() => ['review_required', 'unavailable'].includes(props.decision.decision))

watch(() => props.decision.candidateUri, (candidateUri) => {
  candidateSelection.value = createCandidateSelection(candidateUri)
})

watch(() => props.decision.evidence.candidates.map(candidate => candidate.uri), (candidateUris) => {
  if (candidateSelection.value.draftUri && !candidateUris.includes(candidateSelection.value.draftUri)) {
    const savedUri = candidateUris.includes(candidateSelection.value.savedUri || '')
      ? candidateSelection.value.savedUri
      : null
    candidateSelection.value = createCandidateSelection(savedUri)
  }
})

function selectCandidate(candidateUri: string) {
  candidateSelection.value = chooseCandidate(candidateSelection.value, candidateUri)
}

function confirmCandidate() {
  const request = candidateSelectionRequest(candidateSelection.value)
  if (request) emit('confirm', props.decision.entryId, request.candidateUri)
}

function confirmExclusion() {
  if (window.confirm(`Не переносить трек «${props.decision.source.title}»?`)) {
    emit('exclude', props.decision.entryId)
  }
}
</script>

<template>
  <article class="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045]">
    <div class="p-4 sm:p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span class="text-sm font-bold text-white/35">Трек {{ decision.position + 1 }}</span>
          <span class="text-sm font-bold" :class="needsReview ? 'text-[#ffdc59]' : 'text-[#9ee6b4]'">
            {{ matchDecisionLabel(decision.decision) }}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            :disabled="requestPending || !candidateSelection.draftUri"
            class="min-h-10 rounded-lg bg-[#1db954] px-4 text-sm font-bold text-black disabled:opacity-40"
            @click="confirmCandidate"
          >
            Подтвердить совпадение
          </button>
          <button
            type="button"
            class="min-h-10 shrink-0 rounded-lg border border-white/15 px-4 text-sm font-bold text-white/70 hover:border-white/35"
            :aria-expanded="expanded"
            :aria-label="`${expanded ? 'Скрыть' : 'Открыть'} варианты для трека ${decision.source.title}`"
            @click="expanded = !expanded"
          >
            {{ expanded ? 'Скрыть' : needsReview ? 'Подробнее' : 'Изменить' }}
          </button>
        </div>
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <div class="flex min-w-0 items-center gap-4 rounded-xl border border-[#ffcc00]/20 bg-[#ffcc00]/5 p-3">
          <TrackCover :url="decision.source.coverUrl" :alt="`Обложка Яндекс Музыки: ${decision.source.title}`" provider="yandex" />
          <div class="min-w-0">
            <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#ffdc59]">Яндекс Музыка</p>
            <p class="mt-1 break-words font-bold leading-snug">{{ decision.source.title }}</p>
            <p class="mt-1 break-words text-sm leading-5 text-white/50">{{ decision.source.artists.join(', ') }}</p>
          </div>
        </div>

        <div v-if="selectedCandidate" class="flex min-w-0 items-center gap-4 rounded-xl border border-[#1db954]/20 bg-[#1db954]/5 p-3">
          <TrackCover :url="selectedCandidate.coverUrl" :alt="`Обложка Spotify: ${selectedCandidate.title}`" provider="spotify" />
          <div class="min-w-0">
            <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#74df98]">Spotify</p>
            <p class="mt-1 break-words font-bold leading-snug">{{ selectedCandidate.title }}</p>
            <p class="mt-1 break-words text-sm leading-5 text-white/50">{{ selectedCandidate.artists.join(', ') }}</p>
          </div>
        </div>
        <div v-else class="flex min-h-24 items-center rounded-xl border border-dashed border-white/15 p-4 text-sm text-white/40">
          Вариант Spotify не выбран.
        </div>
      </div>
    </div>

    <div v-if="expanded" class="border-t border-white/10 p-4">
      <div v-if="decision.evidence.candidates.length" class="grid gap-2 lg:grid-cols-2">
        <button
          v-for="candidate in decision.evidence.candidates.slice(0, 10)"
          :key="candidate.uri"
          type="button"
          :disabled="requestPending"
          class="flex min-h-16 items-center gap-3 rounded-xl border p-2 text-left disabled:opacity-50"
          :class="candidate.uri === candidateSelection.draftUri ? 'border-[#1db954] bg-[#1db954]/10' : 'border-white/10 bg-black/20 hover:border-white/25'"
          @click="selectCandidate(candidate.uri)"
        >
          <TrackCover :url="candidate.coverUrl" :alt="`Обложка Spotify: ${candidate.title}`" provider="spotify" size="sm" />
          <span class="min-w-0">
            <strong class="block break-words text-sm leading-snug">{{ candidate.title }}</strong>
            <span class="mt-1 block break-words text-xs leading-5 text-white/45">{{ candidate.artists.join(', ') }}</span>
          </span>
          <span v-if="candidate.uri === candidateSelection.draftUri" class="ml-auto px-2 text-xs font-bold text-[#74df98]">
            {{ candidate.uri === candidateSelection.savedUri
              ? decision.decision === 'accepted' ? 'Сохранено' : 'Предложено'
              : 'Выбрано' }}
          </span>
        </button>
      </div>
      <p v-else class="text-sm text-white/50">Spotify не нашел вариантов.</p>

      <form class="mt-4 border-t border-white/10 pt-4" @submit.prevent="emit('search', decision, query)">
        <label :for="`manual-search-${decision.entryId}`" class="text-sm font-bold">Ручной поиск</label>
        <div class="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            :id="`manual-search-${decision.entryId}`"
            v-model="query"
            type="search"
            required
            maxlength="200"
            placeholder="Название трека или имя исполнителя"
            class="min-h-10 flex-1 rounded-lg border border-white/15 bg-black/20 px-3 text-sm text-white placeholder:text-white/30"
          >
          <button type="submit" :disabled="requestPending" class="min-h-10 rounded-lg border border-[#1db954]/50 px-4 text-sm font-bold text-[#74df98] disabled:opacity-50">
            Найти
          </button>
        </div>
      </form>
      <button
        type="button"
        :disabled="requestPending"
        class="mt-3 min-h-9 rounded-lg border border-white/15 px-3 text-xs font-bold text-white/70 disabled:opacity-50"
        @click="confirmExclusion"
      >
        Не переносить этот трек
      </button>
    </div>
  </article>
</template>
