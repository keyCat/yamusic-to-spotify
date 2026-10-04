export class WorkerLifecycle {
  private pending = new Set<Promise<unknown>>()
  private isStopping = false

  get canRunSteps() { return !this.isStopping }

  runStep(step: () => Promise<unknown>) {
    if (this.isStopping) return
    const operation = Promise.resolve().then(step)
    this.pending.add(operation)
    void operation.catch(() => {}).finally(() => this.pending.delete(operation))
  }

  async stop() {
    this.isStopping = true
    await Promise.allSettled(this.pending)
  }
}

const state = globalThis as typeof globalThis & { desktopWorkerLifecycle?: WorkerLifecycle }
export function ensureWorkerLifecycle() {
  if (!state.desktopWorkerLifecycle?.canRunSteps) state.desktopWorkerLifecycle = new WorkerLifecycle()
  return state.desktopWorkerLifecycle
}
