const cyrillicMap: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function transliterateCyrillic(value: string) {
  return [...value.toLocaleLowerCase('ru')]
    .map(character => cyrillicMap[character] ?? character)
    .join('')
}

export function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizedVariants(value: string) {
  const transliterated = transliterateCyrillic(value)
  const values = [
    normalizeText(value),
    normalizeText(transliterated),
    normalizeText(transliterated.replace(/kh/g, 'h')),
  ]
  return [...new Set(values.flatMap(item => [item, item.replace(/\s+/g, '')]))]
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return intersection / union
}

export function textSimilarity(left: string, right: string) {
  return Math.max(...normalizedVariants(left).flatMap(leftValue => (
    normalizedVariants(right).map(rightValue => tokenSimilarity(leftValue, rightValue))
  )))
}

export function createMatchIdentity(track: {
  title: string
  artists: string[]
  album: string | null
  durationMs: number | null
}) {
  return JSON.stringify({
    title: normalizeText(transliterateCyrillic(track.title)),
    artists: track.artists.map(artist => normalizeText(transliterateCyrillic(artist))),
    album: track.album ? normalizeText(transliterateCyrillic(track.album)) : null,
    durationSecond: track.durationMs === null ? null : Math.round(track.durationMs / 1000),
  })
}
