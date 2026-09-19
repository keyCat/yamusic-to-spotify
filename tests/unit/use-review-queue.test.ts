import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { MatchingJob, ReviewPage } from '../../shared/transfer-api'
import { useReviewQueue } from '../../app/composables/useReviewQueue'

afterEach(() => vi.unstubAllGlobals())

describe('review queue', () => {
  it('resets navigation before loading another job and keeps the page size', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      decisions: [], page: 1, pageSize: 50, total: 0, pageCount: 1,
    } satisfies ReviewPage)
    vi.stubGlobal('$fetch', fetchMock)
    const matchingJob = ref({ id: 'old-job' } as MatchingJob)
    const queue = useReviewQueue({
      matchingJob,
      matchingMessage: ref(''),
      activeStep: ref(2),
      onJobChanged: async () => {},
    })
    queue.reviewPage.value = 3
    queue.reviewPageCount.value = 5
    queue.reviewPageSize.value = 50
    queue.reviewTotal.value = 100
    queue.matchFilter.value = 'review'
    queue.reviewPendingEntry.value = 'old-entry'
    queue.manualSearchEntry.value = 'old-entry'

    queue.clearReviewQueue()

    expect(queue.reviewPage.value).toBe(1)
    expect(queue.reviewPageCount.value).toBe(1)
    expect(queue.reviewTotal.value).toBe(0)
    expect(queue.matchFilter.value).toBe('all')
    expect(queue.reviewPageSize.value).toBe(50)
    expect(queue.reviewPendingEntry.value).toBe('')
    expect(queue.manualSearchEntry.value).toBe('')
    await queue.loadReviewDecisions('new-job')
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/new-job/decisions', {
      query: { page: 1, pageSize: 50, filter: 'all' },
    })
  })
})
