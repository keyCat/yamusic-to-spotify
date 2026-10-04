import { EventEmitter } from 'node:events'
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { utilityProcess } from 'electron'
import { DesktopBackend } from '../../desktop/backend'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }))

class UtilityProcessFixture extends EventEmitter {
  pid: number | undefined = 123456789
  shouldExit = true
  postMessage = vi.fn(() => {
    if (this.shouldExit) queueMicrotask(() => { this.pid = undefined; this.emit('exit', 0) })
  })
}

async function startBackend() {
  const child = new UtilityProcessFixture()
  vi.mocked(utilityProcess.fork).mockReturnValue(child as unknown as ReturnType<typeof utilityProcess.fork>)
  vi.stubGlobal('fetch', vi.fn(async (value: string) => {
    const url = new URL(value)
    if (url.pathname === '/api/desktop/ready') {
      const environment = vi.mocked(utilityProcess.fork).mock.lastCall?.[2]?.env as Record<string, string>
      return new Response(JSON.stringify({ proof: createHmac('sha256', environment.NUXT_DESKTOP_LAUNCH_SECRET!).update(`desktop-ready:${url.searchParams.get('challenge')}`).digest('hex') }))
    }
    return new Response(JSON.stringify({ migrationCount: 4, integrity: 'ok', hasSpotifyConnection: false }))
  }))
  const onUnexpectedExit = vi.fn()
  const backend = new DesktopBackend(onUnexpectedExit)
  await backend.start('/fixture/index.mjs', '/fixture/profile', { spotifyClientId: '' }, 'key')
  return { backend, child, onUnexpectedExit }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('desktop backend lifecycle', () => {
  it('does not launch a child when quit interrupts startup port reservation', async () => {
    const backend = new DesktopBackend(vi.fn())
    const startup = backend.start('/fixture/index.mjs', '/fixture/profile', { spotifyClientId: '' }, 'key')
    await backend.stop()
    await expect(startup).rejects.toThrow('отменен')
    expect(utilityProcess.fork).not.toHaveBeenCalled()
  })

  it('never sends bearer credentials to a loopback service with an invalid readiness proof', async () => {
    const child = new UtilityProcessFixture()
    vi.mocked(utilityProcess.fork).mockReturnValue(child as unknown as ReturnType<typeof utilityProcess.fork>)
    const fetchResponse = vi.fn(async () => {
      queueMicrotask(() => { child.pid = undefined; child.emit('exit', 1) })
      return new Response(JSON.stringify({ proof: 'wrong-service' }))
    })
    vi.stubGlobal('fetch', fetchResponse)
    const backend = new DesktopBackend(vi.fn())
    await expect(backend.start('/fixture/index.mjs', '/fixture/profile', { spotifyClientId: '' }, 'key')).rejects.toThrow('Сервер не запустился')
    expect(fetchResponse).toHaveBeenCalledTimes(3)
    for (const call of vi.mocked(fetch).mock.calls) expect(call[1]).not.toHaveProperty('headers')
  })

  it('sends one graceful shutdown request and awaits child exit without reporting a crash', async () => {
    const { backend, child, onUnexpectedExit } = await startBackend()
    await Promise.all([backend.stop(), backend.stop()])
    expect(child.postMessage).toHaveBeenCalledExactlyOnceWith('shutdown')
    expect(onUnexpectedExit).not.toHaveBeenCalled()
    expect(child.pid).toBeUndefined()
  })

  it('reports an unexpected backend exit after readiness', async () => {
    const { backend, child, onUnexpectedExit } = await startBackend()
    child.pid = undefined
    child.emit('exit', 1)
    expect(onUnexpectedExit).toHaveBeenCalledOnce()
    await backend.stop()
    expect(child.postMessage).not.toHaveBeenCalled()
  })

  it('enforces a shutdown deadline when graceful shutdown is stuck', async () => {
    const { backend, child } = await startBackend()
    child.shouldExit = false
    const killProcess = vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.useFakeTimers()
    const shutdown = backend.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    await shutdown
    expect(killProcess).toHaveBeenCalledWith(child.pid, 'SIGKILL')
  })
})
