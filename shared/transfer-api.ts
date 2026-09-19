export type TransferJobState =
  | 'queued'
  | 'matching'
  | 'review_required'
  | 'ready'
  | 'transferring'
  | 'verifying'
  | 'completed'
  | 'paused'
  | 'failed'
  | 'cancelled'

export type MatchFilter = 'all' | 'matched' | 'review' | 'unavailable' | 'excluded'
export type MatchDecisionState = 'accepted' | 'review_required' | 'unavailable' | 'excluded'

export type ProviderStatus = {
  spotify: { configured: boolean, connected: boolean, identity: string | null }
  yandex: { publicPlaylists: boolean, privatePlaylists: boolean, connections: Array<{ identity: string, status: string }> }
}

export type YandexAuthorization = {
  authorizationId: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

export type PlaylistResult = {
  playlist: {
    id: string
    name: string
    owner: string
    description?: string
    coverUrl: string | null
    declaredTrackCount: number
    returnedTrackCount: number
    tracks?: Array<{
      id: string
      title: string
      artists: string[]
      album: string | null
      coverUrl: string | null
      available: boolean
      position: number
    }>
  }
}

export type YandexCollectionsResult = {
  identity: string
  collections: Array<{
    id: string
    type: 'likes' | 'playlist'
    name: string
    trackCount: number
    revision: number | null
    coverUrl: string | null
  }>
}

export type MatchingJob = {
  id: string
  state: TransferJobState
  pauseReason: string | null
  nextAttemptAt: string | null
  name: string
  total: number
  processed: number
  accepted: number
  reviewRequired: number
  unavailable: number
  excluded: number
  spotifyId: string | null
  canRestart: boolean
}

export type MatchCandidate = {
  uri: string
  title: string
  artists: string[]
  album: string | null
  coverUrl: string | null
  durationMs: number | null
}

export type ReviewDecision = {
  entryId: string
  position: number
  decision: MatchDecisionState
  candidateUri: string | null
  reviewerStatus: 'automatic' | 'pending' | 'user'
  source: SourceTrack
  evidence: {
    score: number
    margin: number
    codes: string[]
    candidates: MatchCandidate[]
  }
}

export type ReviewPage = {
  decisions: ReviewDecision[]
  page: number
  pageSize: number
  total: number
  pageCount: number
}
import type { SourceTrack } from './source'
