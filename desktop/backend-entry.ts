import { pathToFileURL } from 'node:url'

// Preserve native import: the Nitro entry is ESM while the desktop host is CommonJS.
const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>
const parentPort = (process as typeof process & {
  parentPort: { on: (event: string, callback: (event: { data: unknown }) => void) => void }
}).parentPort
parentPort.on('message', event => {
  if (event.data === 'shutdown') process.emit('SIGTERM')
})
void importModule(pathToFileURL(process.argv[2]!).href).catch(() => {
  // Nitro errors can contain private configuration. Do not forward them to the renderer.
  console.error('DESKTOP_BACKEND_START_FAILED')
  process.exit(1)
})
