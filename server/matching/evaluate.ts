import { normalizeText, textSimilarity } from './normalize'

export type MatchTrack = {
  uri: string
  title: string
  artists: string[]
  album: string | null
  coverUrl: string | null
  durationMs: number | null
  available: boolean
  isrc?: string | null
}

export type MatchResult = {
  candidate: MatchTrack | null
  score: number
  margin: number
  decision: 'accepted' | 'review_required' | 'unavailable'
  evidence: string[]
}

const EQUIVALENT_DURATION_DIFFERENCE_MS = 5_000

function durationScore(source: MatchTrack, candidate: MatchTrack) {
  if (source.durationMs === null || candidate.durationMs === null) return 0.5
  const difference = Math.abs(source.durationMs - candidate.durationMs)
  return Math.max(0, 1 - difference / 30_000)
}

function artistScore(sourceArtists: string[], candidateArtists: string[]) {
  return Math.max(
    0,
    ...sourceArtists.flatMap(sourceArtist => (
      candidateArtists.map(candidateArtist => textSimilarity(sourceArtist, candidateArtist))
    )),
  )
}

function scoreCandidate(source: MatchTrack, candidate: MatchTrack) {
  if (!candidate.available) return 0
  if (source.isrc && candidate.isrc && source.isrc === candidate.isrc) return 1
  const title = textSimilarity(source.title, candidate.title)
  const artists = artistScore(source.artists, candidate.artists)
  const album = source.album && candidate.album ? textSimilarity(source.album, candidate.album) : 0.5
  return title * 0.5 + artists * 0.3 + durationScore(source, candidate) * 0.15 + album * 0.05
}

function isEquivalentRecording(left: MatchTrack, right: MatchTrack) {
  if (left.isrc && right.isrc && left.isrc === right.isrc) return true
  if (textSimilarity(left.title, right.title) !== 1) return false
  if (artistScore(left.artists, right.artists) !== 1) return false
  if (left.durationMs === null || right.durationMs === null) return true
  return Math.abs(left.durationMs - right.durationMs) <= EQUIVALENT_DURATION_DIFFERENCE_MS
}

export function evaluateCandidates(source: MatchTrack, candidates: MatchTrack[]): MatchResult {
  const ranked = candidates
    .map(candidate => ({ candidate, score: scoreCandidate(source, candidate) }))
    .sort((left, right) => right.score - left.score)
  const best = ranked[0]
  if (!best) return { candidate: null, score: 0, margin: 0, decision: 'unavailable', evidence: ['NO_CANDIDATES'] }

  const competingRecording = ranked.find(({ candidate }) => !isEquivalentRecording(best.candidate, candidate))
  const margin = best.score - (competingRecording?.score || 0)
  const versionConflict = /\b(live|remix|acoustic|cover|remaster)\b/i.test(
    `${normalizeText(source.title)} ${normalizeText(best.candidate.title)}`,
  ) && normalizeText(source.title) !== normalizeText(best.candidate.title)
  const accepted = best.score >= 0.88 && margin >= 0.08 && !versionConflict

  return {
    candidate: best.candidate,
    score: best.score,
    margin,
    decision: accepted ? 'accepted' : 'review_required',
    evidence: [
      source.isrc && best.candidate.isrc && source.isrc === best.candidate.isrc ? 'ISRC_EQUAL' : 'METADATA_SCORE',
      ...(versionConflict ? ['VERSION_CONFLICT'] : []),
    ],
  }
}
