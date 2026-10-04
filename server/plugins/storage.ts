import { getServerConfig } from '../config'
import { closeDatabase, getDatabase } from '../storage/database'
import { ensureWorkerLifecycle } from '../transfers/worker-lifecycle'

export default defineNitroPlugin((nitroApp) => {
  const config = getServerConfig()
  const lifecycle = ensureWorkerLifecycle()
  getDatabase(config.dataDir)
  nitroApp.hooks.hookOnce('close', async () => {
    await lifecycle.stop()
    closeDatabase()
  })
})
