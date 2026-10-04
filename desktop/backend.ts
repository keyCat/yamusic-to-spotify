import { utilityProcess, type UtilityProcess } from 'electron'
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { DesktopSettingsDto } from '../shared/desktop-api'
import { buildBackendEnvironment } from './environment'

type BackendStatusDto = { hasSpotifyConnection: boolean, migrationCount: number, integrity: string }

async function reservePort() {
  const listener = createServer()
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const port = (listener.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
  return port
}

export class DesktopBackend {
  origin = ''
  windowSecret = ''
  private launchSecret = ''
  private child: UtilityProcess | undefined
  private isStopping = false
  private stopOperation: Promise<void> | undefined
  private generation = 0

  constructor(private readonly onUnexpectedExit: () => void) {}

  async start(entryPath: string, profilePath: string, settings: DesktopSettingsDto, encryptionKey: string) {
    this.stopOperation = undefined
    this.isStopping = false
    const generation = ++this.generation
    for (let attempt = 0; attempt < 3; attempt++) {
      const port = await reservePort()
      if (generation !== this.generation) throw new Error('Запуск сервера отменен.')
      this.origin = `http://127.0.0.1:${port}`
      this.launchSecret = randomBytes(32).toString('base64url')
      this.windowSecret = randomBytes(32).toString('base64url')
      const child = utilityProcess.fork(join(__dirname, 'backend-entry.js'), [entryPath], {
        cwd: profilePath, stdio: 'ignore', serviceName: 'Music transfer backend',
        env: buildBackendEnvironment(process.env, profilePath, settings, encryptionKey, port, this.launchSecret, this.windowSecret),
      })
      this.child = child
      let hasExited = false
      let isReady = false
      child.once('exit', () => {
        hasExited = true
        if (this.child === child) this.child = undefined
        if (isReady && !this.isStopping) this.onUnexpectedExit()
      })
      const deadlineMs = Date.now() + 30_000
      while (!hasExited && generation === this.generation && Date.now() < deadlineMs) {
        try {
          // Prove ownership before sending any bearer credential to a reused loopback port.
          const challenge = randomBytes(32).toString('hex')
          const response = await fetch(`${this.origin}/api/desktop/ready?challenge=${challenge}`, {
            signal: AbortSignal.timeout(3000), redirect: 'error',
          })
          if (!response.ok) throw new Error('Backend not ready')
          const result = await response.json() as { proof?: string }
          const expectedProof = createHmac('sha256', this.launchSecret).update(`desktop-ready:${challenge}`).digest('hex')
          if (result.proof !== expectedProof || hasExited || generation !== this.generation) throw new Error('Unexpected backend identity')
          const status = await this.fetchJson<BackendStatusDto>('/api/desktop/status')
          if (status.integrity !== 'ok' || status.migrationCount < 4) throw new Error('Database integrity check failed')
          isReady = true
          return
        } catch {
          await new Promise(resolve => setTimeout(resolve, 150))
        }
      }
      if (generation !== this.generation) throw new Error('Запуск сервера отменен.')
      await this.stopChild()
      this.stopOperation = undefined
      this.isStopping = false
    }
    throw new Error('Сервер не запустился. Проверьте свободное место и доступ к папке профиля. При повторной ошибке восстановите профиль из резервной копии.')
  }

  async fetchJson<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-desktop-secret': this.launchSecret, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000), redirect: 'error',
    })
    if (!response.ok) throw new Error('Сервер приложения не ответил. Попробуйте перезапустить приложение.')
    return await response.json() as T
  }

  stop(): Promise<void> {
    this.generation++
    return this.stopOperation ||= this.stopChild()
  }

  private async stopChild() {
    this.isStopping = true
    const child = this.child
    if (!child) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (child.pid) {
          try { process.kill(child.pid, 'SIGKILL') } catch {}
        }
        resolve()
      }, 10_000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.postMessage('shutdown')
    })
    if (this.child === child) this.child = undefined
  }

  fetchStatus() { return this.fetchJson<BackendStatusDto>('/api/desktop/status') }
}
