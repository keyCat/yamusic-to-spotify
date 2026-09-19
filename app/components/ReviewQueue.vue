<script setup lang="ts">
import type { MatchFilter, MatchingJob, ReviewDecision } from '../../shared/transfer-api'

defineProps<{
  matchingJob: MatchingJob
  matchFilter: MatchFilter
  reviewDecisions: ReviewDecision[]
  reviewPage: number
  reviewPageSize: number
  reviewTotal: number
  reviewPageCount: number
  reviewPendingEntry: string
  manualSearchEntry: string
}>()

const emit = defineEmits<{
  filterChange: [filter: MatchFilter]
  'update:reviewPageSize': [value: number]
  pageSizeChange: []
  confirm: [entryId: string, candidateUri: string]
  exclude: [entryId: string]
  search: [decision: ReviewDecision, query: string]
  pageChange: [page: number]
}>()
</script>

<template>
        <section
          class="mt-6 space-y-4"
        >
          <div class="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div class="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
              <div>
                <p class="font-bold">Все треки</p>
                <p class="mt-1 text-sm text-white/50">Спорные совпадения показаны первыми.</p>
              </div>
              <div class="flex flex-wrap gap-2" role="group" aria-label="Фильтр совпадений">
                <button
                  v-for="filter in ([
                    { value: 'all', label: 'Все' },
                    { value: 'matched', label: 'Совпали' },
                    { value: 'review', label: 'Требуют проверки' },
                    { value: 'unavailable', label: `Не найдены (${matchingJob.unavailable})` },
                    { value: 'excluded', label: `Не переносятся (${matchingJob.excluded})` },
                  ] as const)"
                  :key="filter.value"
                  type="button"
                  class="min-h-10 rounded-lg border px-3 text-sm font-bold"
                  :class="matchFilter === filter.value ? 'border-[#ffcc00] bg-[#ffcc00] text-black' : 'border-white/15 text-white/65'"
                  :aria-pressed="matchFilter === filter.value"
                  @click="emit('filterChange', filter.value)"
                >
                  {{ filter.label }}
                </button>
              </div>
              <label class="flex items-center gap-2 text-sm text-white/65">
                На странице
                <select
                  :value="reviewPageSize"
                  class="min-h-10 rounded-lg border border-white/15 bg-[#171719] px-3 text-white"
                  @change="emit('update:reviewPageSize', Number(($event.target as HTMLSelectElement).value)); emit('pageSizeChange')"
                >
                  <option :value="10">10</option>
                  <option :value="25">25</option>
                  <option :value="50">50</option>
                  <option :value="100">100</option>
                </select>
              </label>
            </div>
          </div>

          <MatchTrackRow
            v-for="decision in reviewDecisions"
            :key="decision.entryId"
            :decision="decision"
            :request-pending="reviewPendingEntry === decision.entryId || manualSearchEntry === decision.entryId"
            @confirm="(entryId: string, candidateUri: string) => emit('confirm', entryId, candidateUri)"
            @exclude="(entryId: string) => emit('exclude', entryId)"
            @search="(decision: ReviewDecision, query: string) => emit('search', decision, query)"
          />

          <p v-if="!reviewDecisions.length" class="rounded-2xl border border-white/10 bg-white/[0.045] p-5 text-white/55">
            В этом фильтре нет треков.
          </p>

          <nav v-if="reviewPageCount > 1" class="flex items-center justify-between gap-3" aria-label="Страницы совпадений">
            <button type="button" :disabled="reviewPage <= 1" class="min-h-10 rounded-lg border border-white/15 px-4 text-sm font-bold disabled:opacity-40" @click="emit('pageChange', reviewPage - 1)">Назад</button>
            <span class="text-sm text-white/55">{{ reviewPage }} из {{ reviewPageCount }} · {{ reviewTotal }}</span>
            <button type="button" :disabled="reviewPage >= reviewPageCount" class="min-h-10 rounded-lg border border-white/15 px-4 text-sm font-bold disabled:opacity-40" @click="emit('pageChange', reviewPage + 1)">Далее</button>
          </nav>
        </section>

</template>
