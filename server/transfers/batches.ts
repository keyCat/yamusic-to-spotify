export const spotifyBatchSize = 100

export function createTransferBatches(uris: string[]) {
  const batches: string[][] = []
  for (let index = 0; index < uris.length; index += spotifyBatchSize) {
    batches.push(uris.slice(index, index + spotifyBatchSize))
  }
  return batches
}

export function inspectUnknownBatch(actualUris: string[], intendedUris: string[], position: number) {
  const actualAtPosition = actualUris.slice(position, position + intendedUris.length)
  if (actualAtPosition.length !== intendedUris.length) return 'retry' as const
  const batchExists = intendedUris.every((uri, index) => actualAtPosition[index] === uri)
  return batchExists ? 'confirm' as const : 'pause' as const
}
