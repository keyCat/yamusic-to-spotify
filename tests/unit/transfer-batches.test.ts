import { describe, expect, it } from 'vitest'
import { createTransferBatches, inspectUnknownBatch } from '../../server/transfers/batches'

describe('transfer batches', () => {
  it('keeps order and repeated entries', () => {
    const uris = Array.from({ length: 205 }, (_, index) => `spotify:${index % 3}`)
    const batches = createTransferBatches(uris)
    expect(batches.map(batch => batch.length)).toEqual([100, 100, 5])
    expect(batches.flat()).toEqual(uris)
  })

  it('confirms a batch that already exists', () => {
    expect(inspectUnknownBatch(['a', 'b', 'b', 'c'], ['b', 'b'], 1)).toBe('confirm')
  })

  it('pauses after a different write result', () => {
    expect(inspectUnknownBatch(['a', 'x', 'b'], ['b', 'b'], 1)).toBe('pause')
  })
})
