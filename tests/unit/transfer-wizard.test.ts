import { describe, expect, it } from 'vitest'
import * as transferWizard from '../../app/utils/transfer-wizard'

const {
  authorizationErrorText,
  candidateSelectionRequest,
  chooseCandidate,
  contentGridClass,
  createCandidateSelection,
  isReviewDecision,
  matchDecisionLabel,
  matchFilterQuery,
  matchingPollDelay,
  pauseReasonText,
  stepForJobState,
} = transferWizard

describe('transfer wizard', () => {
  it('keeps account and pause messages', () => {
    expect(authorizationErrorText('access_denied')).toBe('Этот аккаунт не входит в список доступа.')
    expect(pauseReasonText('USER_PAUSED')).toBe('Пользователь приостановил задание.')
    expect(pauseReasonText('UNKNOWN')).toBe('UNKNOWN')
  })

  it('maps job states to safe steps', () => {
    expect(stepForJobState(null)).toBe(1)
    expect(stepForJobState('queued')).toBe(2)
    expect(stepForJobState('matching')).toBe(2)
    expect(stepForJobState('review_required')).toBe(2)
    expect(stepForJobState('ready')).toBe(3)
    expect(stepForJobState('transferring')).toBe(4)
    expect(stepForJobState('verifying')).toBe(4)
    expect(stepForJobState('completed')).toBe(4)
    expect(stepForJobState('failed')).toBe(4)
    expect(stepForJobState('cancelled')).toBe(4)
    expect(stepForJobState('paused')).toBe(2)
  })

  it('builds the API query for each match filter', () => {
    expect(matchFilterQuery('all')).toEqual({ filter: 'all' })
    expect(matchFilterQuery('matched')).toEqual({ filter: 'matched' })
    expect(matchFilterQuery('review')).toEqual({ filter: 'review' })
    expect(matchFilterQuery('unavailable')).toEqual({ filter: 'unavailable' })
    expect(matchFilterQuery('excluded')).toEqual({ filter: 'excluded' })
  })

  it('classifies unresolved decisions as review items', () => {
    expect(isReviewDecision('accepted')).toBe(false)
    expect(isReviewDecision('excluded')).toBe(false)
    expect(isReviewDecision('review_required')).toBe(true)
    expect(isReviewDecision('unavailable')).toBe(true)
  })

  it('labels a missing Spotify track separately from an uncertain match', () => {
    expect(matchDecisionLabel('unavailable')).toBe('Не найдено в Spotify')
    expect(matchDecisionLabel('review_required')).toBe('Требует проверки')
    expect(matchDecisionLabel('excluded')).toBe('Не переносится')
    expect(matchDecisionLabel('accepted')).toBe('Совпало')
  })

  it('keeps a candidate choice as a draft until confirmation', () => {
    const initial = createCandidateSelection('spotify:track:suggested')
    const changed = chooseCandidate(initial, 'spotify:track:alternate')

    expect(initial).toEqual({ savedUri: 'spotify:track:suggested', draftUri: 'spotify:track:suggested' })
    expect(changed).toEqual({ savedUri: 'spotify:track:suggested', draftUri: 'spotify:track:alternate' })
    expect(candidateSelectionRequest(changed)).toEqual({
      action: 'select',
      candidateUri: 'spotify:track:alternate',
    })
  })

  it('does not create a selection request without a draft', () => {
    expect(candidateSelectionRequest(createCandidateSelection(null))).toBeNull()
  })

  it('uses the full page width after source selection', () => {
    expect(contentGridClass(1)).toContain('lg:grid-cols-[1.2fr_0.8fr]')
    expect(contentGridClass(2)).toContain('grid-cols-1')
    expect(contentGridClass(2)).not.toContain('lg:grid-cols-[1.2fr_0.8fr]')
    expect(contentGridClass(3)).toContain('grid-cols-1')
    expect(contentGridClass(4)).toContain('grid-cols-1')
  })

  it('allows navigation only to safe steps', () => {
    const navigableSteps = (transferWizard as typeof transferWizard & {
      navigableSteps?: (state: Parameters<typeof stepForJobState>[0]) => number[]
    }).navigableSteps

    expect(navigableSteps?.(null)).toEqual([1])
    expect(navigableSteps?.('matching')).toEqual([1, 2])
    expect(navigableSteps?.('review_required')).toEqual([1, 2])
    expect(navigableSteps?.('ready')).toEqual([1, 2, 3])
    expect(navigableSteps?.('transferring')).toEqual([4])
    expect(navigableSteps?.('completed')).toEqual([1, 4])
  })

  it('reduces polling while Spotify waits for a quota reset', () => {
    const now = Date.parse('2026-09-16T10:00:00.000Z')

    expect(matchingPollDelay(null, now)).toBe(1_000)
    expect(matchingPollDelay('2026-09-16T10:00:00.500Z', now)).toBe(1_000)
    expect(matchingPollDelay('2026-09-16T10:00:30.000Z', now)).toBe(30_000)
    expect(matchingPollDelay('2026-09-17T10:00:00.000Z', now)).toBe(60_000)
  })
})
