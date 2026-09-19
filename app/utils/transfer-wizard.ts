import type { MatchDecisionState, MatchFilter, TransferJobState } from '../../shared/transfer-api'

export type { MatchDecisionState, MatchFilter, TransferJobState } from '../../shared/transfer-api'

const authorizationErrors: Record<string, string> = {
  invalid_request: 'Откройте сервис по адресу 127.0.0.1 и повторите подключение.',
  expired_request: 'Срок запроса истек. Повторите подключение Spotify.',
  access_denied: 'Этот аккаунт не входит в список доступа.',
  provider_failure: 'Spotify не завершил подключение. Повторите попытку.',
}

const pauseReasons: Record<string, string> = {
  USER_PAUSED: 'Пользователь приостановил задание.',
  ACCOUNT_DISCONNECTED: 'Аккаунт отключен.',
  SPOTIFY_RECONNECT_REQUIRED: 'Spotify требует повторного подключения.',
  SPOTIFY_QUOTA_EXCEEDED: 'Spotify исчерпал доступную квоту запросов.',
  SPOTIFY_PLAYLIST_AMBIGUOUS: 'Spotify вернул несколько плейлистов для восстановления.',
  SPOTIFY_BATCH_MISMATCH: 'Состав плейлиста не совпал с контрольными данными.',
  SPOTIFY_VERIFICATION_MISMATCH: 'Итоговый порядок треков не совпал с планом.',
}

export function authorizationErrorText(code: string): string {
  return authorizationErrors[code] || ''
}

export function pauseReasonText(reason: string): string {
  return pauseReasons[reason] || reason
}

export type CandidateSelection = {
  savedUri: string | null
  draftUri: string | null
}

export function createCandidateSelection(savedUri: string | null): CandidateSelection {
  return { savedUri, draftUri: savedUri }
}

export function chooseCandidate(selection: CandidateSelection, candidateUri: string): CandidateSelection {
  return { ...selection, draftUri: candidateUri }
}

export function candidateSelectionRequest(selection: CandidateSelection) {
  if (!selection.draftUri) return null
  return { action: 'select' as const, candidateUri: selection.draftUri }
}

export function stepForJobState(state: TransferJobState | null): 1 | 2 | 3 | 4 {
  if (!state) return 1
  if (state === 'ready') return 3
  if (['transferring', 'verifying', 'completed', 'failed', 'cancelled'].includes(state)) return 4
  return 2
}

export function navigableSteps(state: TransferJobState | null): Array<1 | 2 | 3 | 4> {
  if (!state) return [1]
  if (state === 'ready') return [1, 2, 3]
  if (['transferring', 'verifying'].includes(state)) return [4]
  if (['completed', 'failed', 'cancelled'].includes(state)) return [1, 4]
  return [1, 2]
}

export function matchFilterQuery(filter: MatchFilter) {
  return { filter }
}

export function isReviewDecision(decision: MatchDecisionState) {
  return decision === 'review_required' || decision === 'unavailable'
}

export function matchDecisionLabel(decision: MatchDecisionState) {
  if (decision === 'unavailable') return 'Не найдено в Spotify'
  if (decision === 'review_required') return 'Требует проверки'
  if (decision === 'excluded') return 'Не переносится'
  return 'Совпало'
}

export function contentGridClass(step: 1 | 2 | 3 | 4) {
  return step === 1 ? 'lg:grid-cols-[1.2fr_0.8fr]' : 'grid-cols-1'
}

export function matchingPollDelay(nextAttemptAt: string | null, now = Date.now()) {
  if (!nextAttemptAt) return 1_000
  const delay = Date.parse(nextAttemptAt) - now
  if (!Number.isFinite(delay)) return 1_000
  return Math.min(60_000, Math.max(1_000, delay))
}
