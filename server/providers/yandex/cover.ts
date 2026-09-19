export function yandexCoverUrl(value: string | null | undefined) {
  if (!value) return null
  const sized = value.replace('%%', '400x400')
  if (/^https?:\/\//i.test(sized)) return sized.replace(/^http:\/\//i, 'https://')
  return `https://${sized.replace(/^\/+/, '')}`
}
