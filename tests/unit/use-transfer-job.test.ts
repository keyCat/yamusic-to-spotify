import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, h, ref } from 'vue'
import type { MatchingJob, TransferJobState, YandexCollectionsResult } from '../../shared/transfer-api'
import { useTransferJob } from '../../app/composables/useTransferJob'

type Node = { children: Node[] }

const renderer = createRenderer<Node, Node>({
  patchProp: () => {},
  insert: (child, parent) => { parent.children.push(child) },
  remove: () => {},
  createElement: () => ({ children: [] }),
  createText: () => ({ children: [] }),
  createComment: () => ({ children: [] }),
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null,
})

function job(state: TransferJobState, id = 'job') {
  return { id, name: 'Плейлист', state, nextAttemptAt: null } as MatchingJob
}

function mountJob() {
  const matchingJob = ref<MatchingJob | null>(null)
  const matchingMessage = ref('')
  const activeStep = ref<1 | 2 | 3 | 4>(1)
  const inspectedPublicPlaylistUrl = ref('')
  const clearReviewQueue = vi.fn()
  let controller!: ReturnType<typeof useTransferJob>
  const app = renderer.createApp({
    setup() {
      controller = useTransferJob({
        matchingJob,
        matchingMessage,
        activeStep,
        collectionsResult: ref<YandexCollectionsResult | null>(null),
        selectedCollectionId: ref(''),
        inspectedPublicPlaylistUrl,
        onReviewNeeded: async () => {},
        clearReviewQueue,
      })
      return () => h('div')
    },
  })
  app.mount({ children: [] })
  return { app, controller, matchingJob, matchingMessage, activeStep, clearReviewQueue, inspectedPublicPlaylistUrl }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('transfer job polling', () => {
  it('keeps one timer through pause and resume and clears it on unmount', async () => {
    let state: TransferJobState = 'matching'
    const fetchMock = vi.fn(async (url: string, options?: { method?: string }) => {
      if (url === '/api/jobs/latest') return { job: job(state) }
      if (options?.method === 'POST') {
        state = url.endsWith('/pause') ? 'paused' : url.endsWith('/cancel') ? 'cancelled' : 'matching'
        return { status: state }
      }
      return { job: job(state) }
    })
    vi.stubGlobal('$fetch', fetchMock)
    const { app, controller, clearReviewQueue, activeStep } = mountJob()

    await controller.restoreMatchingJob()
    expect(vi.getTimerCount()).toBe(1)
    await controller.controlJob('pause')
    expect(vi.getTimerCount()).toBe(0)
    await controller.controlJob('resume')
    expect(vi.getTimerCount()).toBe(1)

    const jobReads = () => fetchMock.mock.calls.filter(([url, options]) =>
      url === '/api/jobs/job' && !options).length
    const beforePoll = jobReads()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(jobReads()).toBe(beforePoll + 1)
    expect(vi.getTimerCount()).toBe(1)
    vi.stubGlobal('window', { confirm: () => true })
    await controller.controlJob('cancel')
    expect(clearReviewQueue).toHaveBeenCalledOnce()
    expect(activeStep.value).toBe(4)
    expect(vi.getTimerCount()).toBe(0)
    app.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a transient error and stops after an authorization error', async () => {
    let reads = 0
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/jobs/latest') return { job: job('matching') }
      reads += 1
      if (reads === 1) throw { statusCode: 503, data: { statusMessage: 'Временная ошибка.' } }
      if (reads === 3) throw { statusCode: 401, data: { statusMessage: 'Сеанс истек.' } }
      return { job: job('matching') }
    }))
    const { app, controller, matchingMessage } = mountJob()

    await controller.restoreMatchingJob()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toBe(1)
    expect(matchingMessage.value).toBe('Временная ошибка.')
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toBe(2)
    expect(matchingMessage.value).toBe('')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toBe(3)
    expect(matchingMessage.value).toBe('Сеанс истек.')
    expect(vi.getTimerCount()).toBe(0)
    app.unmount()
  })

  it('ignores an older response after a newer read succeeds', async () => {
    let resolveOld!: (value: { job: MatchingJob }) => void
    let reads = 0
    vi.stubGlobal('$fetch', vi.fn((url: string) => {
      if (url === '/api/jobs/latest') return Promise.resolve({ job: job('matching') })
      reads += 1
      if (reads === 1) return new Promise(resolve => { resolveOld = resolve })
      return Promise.resolve({ job: job('matching') })
    }))
    const { app, controller, matchingJob } = mountJob()

    await controller.restoreMatchingJob()
    const oldRead = controller.readMatchingJob('job')
    await controller.readMatchingJob('job')
    resolveOld({ job: job('completed') })
    await oldRead

    expect(matchingJob.value?.state).toBe('matching')
    expect(vi.getTimerCount()).toBe(1)
    controller.resetJob()
    expect(vi.getTimerCount()).toBe(0)
    app.unmount()
  })

  it('clears the old review queue when a new job starts', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/jobs') return { jobId: 'new-job' }
      return { job: job('matching', 'new-job') }
    }))
    const { app, controller, clearReviewQueue, inspectedPublicPlaylistUrl } = mountJob()
    inspectedPublicPlaylistUrl.value = 'https://music.yandex.ru/users/a/playlists/1'

    await controller.startPublicMatching()

    expect(clearReviewQueue).toHaveBeenCalledOnce()
    expect(controller.activeJobId.value).toBe('new-job')
    expect(vi.getTimerCount()).toBe(1)
    app.unmount()
  })

  it('refreshes a cancelled job after a transient read error', async () => {
    let state: TransferJobState = 'ready'
    let reads = 0
    vi.stubGlobal('window', { confirm: () => true })
    vi.stubGlobal('$fetch', vi.fn(async (url: string, options?: { method?: string }) => {
      if (url === '/api/jobs/latest') return { job: job(state) }
      if (options?.method === 'POST') {
        state = 'cancelled'
        return { status: state }
      }
      reads += 1
      if (reads === 1) throw { statusCode: 503 }
      return { job: job(state) }
    }))
    const { app, controller, activeStep, clearReviewQueue } = mountJob()

    await controller.restoreMatchingJob()
    expect(activeStep.value).toBe(3)
    await controller.controlJob('cancel')
    expect(clearReviewQueue).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(activeStep.value).toBe(4)
    expect(reads).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
    app.unmount()
  })
})
