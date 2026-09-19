import { ref, type Ref } from 'vue'
import type { MatchCandidate, MatchFilter, MatchingJob, ReviewDecision, ReviewPage } from '../../shared/transfer-api'
import { matchFilterQuery } from '../utils/transfer-wizard'

type ReviewOptions = {
  matchingJob: Ref<MatchingJob | null>
  matchingMessage: Ref<string>
  activeStep: Ref<1 | 2 | 3 | 4>
  onJobChanged: (jobId: string) => Promise<void>
}

export function useReviewQueue(options: ReviewOptions) {
  const matchFilter = ref<MatchFilter>('all')
  const reviewDecisions = ref<ReviewDecision[]>([])
  const reviewPage = ref(1)
  const reviewPageSize = ref(25)
  const reviewTotal = ref(0)
  const reviewPageCount = ref(1)
  const reviewPendingEntry = ref('')
  const manualSearchEntry = ref('')

  async function loadReviewDecisions(jobId: string, page = reviewPage.value) {
    try {
      const result = await $fetch<ReviewPage>(`/api/jobs/${jobId}/decisions`, {
        query: { page, pageSize: reviewPageSize.value, ...matchFilterQuery(matchFilter.value) },
      })
      reviewDecisions.value = result.decisions
      reviewPage.value = result.page
      reviewPageSize.value = result.pageSize
      reviewTotal.value = result.total
      reviewPageCount.value = result.pageCount
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      options.matchingMessage.value = response.data?.statusMessage || 'Не удалось получить спорные совпадения.'
    }
  }

  async function changeMatchFilter(filter: MatchFilter) {
    if (!options.matchingJob.value) return
    matchFilter.value = filter
    await loadReviewDecisions(options.matchingJob.value.id, 1)
  }

  async function changeReviewPage(page: number) {
    if (!options.matchingJob.value || page < 1 || page > reviewPageCount.value) return
    await loadReviewDecisions(options.matchingJob.value.id, page)
  }

  async function changeReviewPageSize() {
    if (!options.matchingJob.value) return
    await loadReviewDecisions(options.matchingJob.value.id, 1)
  }

  async function searchManually(decision: ReviewDecision, value?: string) {
    if (!options.matchingJob.value) return
    const query = value?.trim()
    if (!query) {
      options.matchingMessage.value = 'Введите название трека или имя исполнителя.'
      return
    }
    manualSearchEntry.value = decision.entryId
    options.matchingMessage.value = ''
    try {
      const result = await $fetch<{ candidates: MatchCandidate[] }>(
        `/api/jobs/${options.matchingJob.value.id}/decisions/${decision.entryId}/search`,
        { method: 'POST', body: { query } },
      )
      decision.evidence.candidates = result.candidates
      if (!result.candidates.length) options.matchingMessage.value = 'Spotify не нашел треки по этому запросу.'
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      options.matchingMessage.value = response.data?.statusMessage || 'Не удалось выполнить ручной поиск.'
    } finally {
      manualSearchEntry.value = ''
    }
  }

  async function saveReviewDecision(
    entryId: string,
    body: { action: 'select', candidateUri: string } | { action: 'exclude' },
  ) {
    if (!options.matchingJob.value) return
    reviewPendingEntry.value = entryId
    options.matchingMessage.value = ''
    try {
      await $fetch(`/api/jobs/${options.matchingJob.value.id}/decisions/${entryId}`, { method: 'PUT', body })
      await options.onJobChanged(options.matchingJob.value.id)
      if (options.activeStep.value === 2) await loadReviewDecisions(options.matchingJob.value.id, reviewPage.value)
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      options.matchingMessage.value = response.data?.statusMessage || 'Не удалось сохранить решение.'
    } finally {
      reviewPendingEntry.value = ''
    }
  }

  function clearReviewQueue() {
    reviewDecisions.value = []
    reviewPage.value = 1
    reviewTotal.value = 0
    reviewPageCount.value = 1
    matchFilter.value = 'all'
    reviewPendingEntry.value = ''
    manualSearchEntry.value = ''
  }

  return {
    matchFilter,
    reviewDecisions,
    reviewPage,
    reviewPageSize,
    reviewTotal,
    reviewPageCount,
    reviewPendingEntry,
    manualSearchEntry,
    loadReviewDecisions,
    changeMatchFilter,
    changeReviewPage,
    changeReviewPageSize,
    searchManually,
    saveReviewDecision,
    clearReviewQueue,
  }
}
