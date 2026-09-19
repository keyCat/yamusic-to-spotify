import { getServerConfig } from '../config'
import { closeDatabase, getDatabase } from '../storage/database'

export default defineNitroPlugin((nitroApp) => {
  const config = getServerConfig()
  getDatabase(config.dataDir)
  nitroApp.hooks.hookOnce('close', () => closeDatabase())
})
