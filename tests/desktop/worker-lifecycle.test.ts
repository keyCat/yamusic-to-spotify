import { describe, expect, it, vi } from 'vitest'
import { ensureWorkerLifecycle, WorkerLifecycle } from '../../server/transfers/worker-lifecycle'

describe('worker shutdown', () => {
  it('drains active work before allowing storage to close and rejects new work', async () => {
    const lifecycle = new WorkerLifecycle()
    let complete!: () => void
    const operation = new Promise<void>(resolve => { complete = resolve })
    const closeStorage = vi.fn()
    lifecycle.runStep(() => operation)
    const shutdown = lifecycle.stop().then(closeStorage)
    const lateStep = vi.fn(async () => {})
    lifecycle.runStep(lateStep)
    await Promise.resolve()
    expect(closeStorage).not.toHaveBeenCalled()
    expect(lateStep).not.toHaveBeenCalled()
    complete()
    await shutdown
    expect(closeStorage).toHaveBeenCalledOnce()
  })

  it('finishes shutdown even if an active operation fails', async () => {
    const lifecycle = new WorkerLifecycle()
    lifecycle.runStep(async () => { throw new Error('provider network error') })
    await expect(lifecycle.stop()).resolves.toBeUndefined()
  })

  it('creates a fresh lifecycle for a development server restarted in the same process', async () => {
    const first = ensureWorkerLifecycle()
    await first.stop()
    const restarted = ensureWorkerLifecycle()
    expect(restarted).not.toBe(first)
    expect(restarted.canRunSteps).toBe(true)
    await restarted.stop()
  })
})
