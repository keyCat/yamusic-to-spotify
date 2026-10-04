import { getServerConfig } from '../config'
import { runMatchingStep } from '../transfers/matching-worker'
import { runTransferStep } from '../transfers/transfer-worker'
import { cleanupExpiredData } from '../storage/cleanup'
import { getDatabase } from '../storage/database'
import { ensureWorkerLifecycle } from '../transfers/worker-lifecycle'

type WorkerState = { matchingWorkerTimer?: ReturnType<typeof setInterval>, nextCleanupAt?: number }
const state = globalThis as typeof globalThis & WorkerState

export default defineNitroPlugin((nitroApp) => {
  if (state.matchingWorkerTimer) clearInterval(state.matchingWorkerTimer)
  const config = getServerConfig()
  const lifecycle = ensureWorkerLifecycle()
  cleanupExpiredData(getDatabase(config.dataDir))
  state.nextCleanupAt = Date.now() + 60 * 60 * 1000
  const timer = setInterval(() => {
    lifecycle.runStep(() => runMatchingStep(config))
    lifecycle.runStep(() => runTransferStep(config))
    if (Date.now() >= (state.nextCleanupAt || 0)) {
      cleanupExpiredData(getDatabase(config.dataDir))
      state.nextCleanupAt = Date.now() + 60 * 60 * 1000
    }
  }, 500)
  state.matchingWorkerTimer = timer
  nitroApp.hooks.hook('close', async () => {
    clearInterval(timer)
    if (state.matchingWorkerTimer === timer) state.matchingWorkerTimer = undefined
    await lifecycle.stop()
  })
})
