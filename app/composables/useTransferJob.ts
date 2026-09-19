import { onUnmounted, ref, type Ref } from 'vue'
import type { MatchingJob, YandexCollectionsResult } from '../../shared/transfer-api'
import { matchingPollDelay, stepForJobState } from '../utils/transfer-wizard'

type JobOptions = {
  matchingJob: Ref<MatchingJob | null>
  matchingMessage: Ref<string>
  activeStep: Ref<1 | 2 | 3 | 4>
  collectionsResult: Ref<YandexCollectionsResult | null>
  selectedCollectionId: Ref<string>
  inspectedPublicPlaylistUrl: Ref<string>
  onReviewNeeded: (jobId: string) => Promise<void>
  clearReviewQueue: () => void
}

export function useTransferJob(options: JobOptions) {
  const confirmationPending = ref(false)
  const jobControlPending = ref(false)
  const activeJobId = ref<string | null>(null)
  let matchingTimer: ReturnType<typeof setTimeout> | undefined
  let readGeneration = 0
  let failedReads = 0
  let lastReadError = ''

  function clearMatchingTimer() {
    if (matchingTimer) clearTimeout(matchingTimer)
    matchingTimer = undefined
  }

  function schedulePoll(jobId: string, delay: number) {
    clearMatchingTimer()
    matchingTimer = setTimeout(() => {
      matchingTimer = undefined
      void readMatchingJob(jobId)
    }, delay)
  }

  function invalidateReads() {
    readGeneration += 1
    clearMatchingTimer()
    failedReads = 0
    lastReadError = ''
  }

  async function readMatchingJob(jobId: string) {
    if (activeJobId.value !== jobId) return
    clearMatchingTimer()
    const generation = ++readGeneration
    try {
      const result = await $fetch<{ job: MatchingJob }>(`/api/jobs/${jobId}`)
      if (activeJobId.value !== jobId || generation !== readGeneration) return
      failedReads = 0
      if (lastReadError && options.matchingMessage.value === lastReadError) options.matchingMessage.value = ''
      lastReadError = ''
      options.matchingJob.value = result.job
      if (['transferring', 'verifying', 'completed', 'failed', 'cancelled'].includes(result.job.state)) options.activeStep.value = 4
      if (['queued', 'matching', 'transferring', 'verifying'].includes(result.job.state)) {
        schedulePoll(jobId, matchingPollDelay(result.job.nextAttemptAt))
      } else if (['review_required', 'ready'].includes(result.job.state) && options.activeStep.value === 2) {
        await options.onReviewNeeded(jobId)
      }
    } catch (error) {
      if (activeJobId.value !== jobId || generation !== readGeneration) return
      const response = error as {
        statusCode?: number
        status?: number
        response?: { status?: number }
        data?: { statusMessage?: string }
      }
      lastReadError = response.data?.statusMessage || 'Не удалось получить состояние поиска.'
      options.matchingMessage.value = lastReadError
      const status = response.statusCode ?? response.status ?? response.response?.status
      const permanentError = status && status >= 400 && status < 500 && ![408, 429].includes(status)
      if (!permanentError) {
        failedReads += 1
        const retryDelay = Math.min(60_000, 1_000 * 2 ** Math.min(failedReads - 1, 6))
        schedulePoll(jobId, Math.max(retryDelay, matchingPollDelay(options.matchingJob.value?.nextAttemptAt || null)))
      }
    }
  }

  async function confirmTransfer() {
    if (!options.matchingJob.value) return
    const jobId = options.matchingJob.value.id
    confirmationPending.value = true
    options.matchingMessage.value = ''
    try {
      await $fetch(`/api/jobs/${jobId}/confirm`, { method: 'POST' })
      if (activeJobId.value !== jobId) return
      options.activeStep.value = 4
      await readMatchingJob(jobId)
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      options.matchingMessage.value = response.data?.statusMessage || 'Не удалось подтвердить перенос.'
    } finally {
      confirmationPending.value = false
    }
  }

  async function restoreMatchingJob() {
    invalidateReads()
    const generation = readGeneration
    try {
      const result = await $fetch<{ job: MatchingJob | null }>('/api/jobs/latest')
      if (!result.job || generation !== readGeneration) return
      activeJobId.value = result.job.id
      options.matchingJob.value = result.job
      options.activeStep.value = stepForJobState(result.job.state)
      if (['queued', 'matching', 'transferring', 'verifying'].includes(result.job.state)) {
        schedulePoll(result.job.id, matchingPollDelay(result.job.nextAttemptAt))
      } else if (['review_required', 'ready'].includes(result.job.state)) {
        await options.onReviewNeeded(result.job.id)
      }
    } catch {
      // The account state shows the applicable session error.
    }
  }

  function confirmNewSearch(message: string) {
    if (!options.matchingJob.value) return true
    return window.confirm(message)
  }

  async function activateMatchingJob(jobId: string) {
    invalidateReads()
    activeJobId.value = jobId
    options.matchingJob.value = null
    options.clearReviewQueue()
    options.activeStep.value = 2
    await readMatchingJob(jobId)
  }

  async function startMatching() {
    if (!options.collectionsResult.value || !options.selectedCollectionId.value) return
    if (!confirmNewSearch('Текущее задание будет отменено. Начать новый поиск?')) return
    options.matchingMessage.value = ''
    try {
      const result = await $fetch<{ jobId: string }>('/api/jobs', {
        method: 'POST',
        body: {
          sourceType: 'private',
          requestId: crypto.randomUUID(),
          replaceJobId: options.matchingJob.value?.id,
          identity: options.collectionsResult.value.identity,
          collectionId: options.selectedCollectionId.value,
        },
      })
      await activateMatchingJob(result.jobId)
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      options.matchingMessage.value = response.data?.statusMessage || 'Не удалось начать поиск.'
    }
  }

  async function startPublicMatching() {
    if (!options.inspectedPublicPlaylistUrl.value) return
    if (!confirmNewSearch('Текущее задание будет отменено. Начать новый поиск?')) return
    options.matchingMessage.value = ''
    try {
      const result = await $fetch<{ jobId: string }>('/api/jobs', {
        method: 'POST',
        body: {
          sourceType: 'public',
          requestId: crypto.randomUUID(),
          replaceJobId: options.matchingJob.value?.id,
          url: options.inspectedPublicPlaylistUrl.value,
        },
      })
      await activateMatchingJob(result.jobId)
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      options.matchingMessage.value = response.data?.statusMessage || 'Не удалось начать поиск.'
    }
  }

  async function restartCurrentSearch() {
    if (!options.matchingJob.value?.canRestart) return
    if (!window.confirm('Текущее задание будет отменено. Повторить поиск для этого плейлиста?')) return
    jobControlPending.value = true
    options.matchingMessage.value = ''
    try {
      const result = await $fetch<{ jobId: string }>(`/api/jobs/${options.matchingJob.value.id}/restart`, { method: 'POST' })
      await activateMatchingJob(result.jobId)
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      options.matchingMessage.value = response.data?.statusMessage || 'Не удалось повторить поиск. Текущее задание сохранено.'
    } finally {
      jobControlPending.value = false
    }
  }

  async function controlJob(action: 'pause' | 'resume' | 'cancel') {
    if (!options.matchingJob.value) return
    const jobId = options.matchingJob.value.id
    if (action === 'cancel' && !window.confirm('Отменить дальнейшую работу по этому заданию?')) return
    jobControlPending.value = true
    options.matchingMessage.value = ''
    try {
      await $fetch(`/api/jobs/${jobId}/${action}`, { method: 'POST' })
      if (activeJobId.value !== jobId) return
      if (action === 'cancel') options.clearReviewQueue()
      await readMatchingJob(jobId)
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      options.matchingMessage.value = response.data?.statusMessage || 'Не удалось изменить состояние задания.'
    } finally {
      jobControlPending.value = false
    }
  }

  function resetJob() {
    invalidateReads()
    activeJobId.value = null
    options.matchingJob.value = null
  }

  onUnmounted(() => {
    invalidateReads()
  })

  return {
    confirmationPending,
    jobControlPending,
    activeJobId,
    readMatchingJob,
    confirmTransfer,
    restoreMatchingJob,
    startMatching,
    startPublicMatching,
    restartCurrentSearch,
    controlJob,
    resetJob,
  }
}
