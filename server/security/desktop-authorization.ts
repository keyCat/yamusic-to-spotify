import { createSecret } from './secrets'

type DesktopAuthorizationRecord = {
  id: string
  state: string
  verifier: string
  expiresAtMs: number
  status: 'pending' | 'exchanging' | 'complete' | 'failed'
  session?: string
}

export class DesktopAuthorization {
  private request: DesktopAuthorizationRecord | undefined

  createAttempt(state: string, verifier: string, nowMs = Date.now()) {
    this.request = { id: createSecret(), state, verifier, expiresAtMs: nowMs + 600_000, status: 'pending' }
    return this.request.id
  }

  consumeCallback(state: string, nowMs = Date.now()) {
    const request = this.request
    if (!request || request.state !== state || request.status !== 'pending' || request.expiresAtMs <= nowMs) return undefined
    request.status = 'exchanging'
    return request
  }

  completeAttempt(request: DesktopAuthorizationRecord, session: string, nowMs = Date.now()) {
    if (this.request !== request || request.expiresAtMs <= nowMs) return false
    request.session = session
    request.status = 'complete'
    return true
  }

  failAttempt(request: DesktopAuthorizationRecord) {
    if (this.request === request) request.status = 'failed'
  }

  claimSession(id: string, nowMs = Date.now()) {
    const request = this.request
    if (!request || request.id !== id) return { status: 'failed' as const }
    if (request.expiresAtMs <= nowMs) {
      this.request = undefined
      return { status: 'failed' as const }
    }
    if (request.status === 'pending' || request.status === 'exchanging') return { status: 'pending' as const }
    this.request = undefined
    return request.status === 'complete'
      ? { status: 'complete' as const, session: request.session! }
      : { status: 'failed' as const }
  }
}

export const desktopAuthorization = new DesktopAuthorization()
