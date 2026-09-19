import { describe, expect, it } from 'vitest'
import { evaluateCandidates, type MatchTrack } from '../../server/matching/evaluate'

const source: MatchTrack = {
  uri: 'yandex:1', title: 'Тихая ночь', artists: ['Исполнитель'], album: 'Альбом', coverUrl: null, durationMs: 180_000, available: true,
}

describe('candidate evaluation', () => {
  it('accepts a clear metadata match', () => {
    const result = evaluateCandidates(source, [
      { ...source, uri: 'spotify:track:best' },
      { ...source, uri: 'spotify:track:other', title: 'Другая песня', artists: ['Другой автор'] },
    ])
    expect(result.decision).toBe('accepted')
    expect(result.candidate?.uri).toBe('spotify:track:best')
  })

  it('ignores duplicate Spotify releases with the same ISRC', () => {
    const result = evaluateCandidates({
      ...source,
      title: 'Given Up',
      artists: ['Linkin Park'],
      album: 'Minutes to Midnight',
      durationMs: 189_290,
    }, [
      {
        ...source,
        uri: 'spotify:track:album',
        title: 'Given Up',
        artists: ['Linkin Park'],
        album: 'Minutes to Midnight',
        durationMs: 189_293,
        isrc: 'USWB10701211',
      },
      {
        ...source,
        uri: 'spotify:track:duplicate',
        title: 'Given Up',
        artists: ['Linkin Park'],
        album: 'Minutes to Midnight',
        durationMs: 189_293,
        isrc: 'USWB10701211',
      },
    ])

    expect(result.decision).toBe('accepted')
    expect(result.candidate?.uri).toBe('spotify:track:album')
    expect(result.margin).toBeGreaterThanOrEqual(0.08)
  })

  it('groups nearby releases with different ISRC values as one recording', () => {
    const result = evaluateCandidates({
      ...source,
      title: 'Party With the Devil',
      artists: ['Attila'],
      album: 'Party With the Devil',
      durationMs: 203_150,
    }, [
      {
        ...source,
        uri: 'spotify:track:single',
        title: 'Party With The Devil',
        artists: ['Attila'],
        album: 'Party With The Devil',
        durationMs: 202_880,
        isrc: 'USRZR1256701',
      },
      {
        ...source,
        uri: 'spotify:track:album',
        title: 'Party With The Devil',
        artists: ['Attila'],
        album: 'About That Life',
        durationMs: 199_493,
        isrc: 'USRZR1341213',
      },
    ])

    expect(result.decision).toBe('accepted')
    expect(result.candidate?.uri).toBe('spotify:track:single')
    expect(result.margin).toBeGreaterThanOrEqual(0.08)
  })

  it('keeps nearby duration variants in separate recording groups', () => {
    const result = evaluateCandidates({
      ...source,
      title: 'One Song',
      artists: ['One Artist'],
      album: 'One Album',
      durationMs: 200_000,
    }, [
      {
        ...source,
        uri: 'spotify:track:original',
        title: 'One Song',
        artists: ['One Artist'],
        album: 'One Album',
        durationMs: 200_000,
        isrc: 'FIRST',
      },
      {
        ...source,
        uri: 'spotify:track:variant',
        title: 'One Song',
        artists: ['One Artist'],
        album: 'Another Album',
        durationMs: 206_000,
        isrc: 'SECOND',
      },
    ])

    expect(result.decision).toBe('review_required')
  })

  it('requires review for a version conflict', () => {
    const result = evaluateCandidates(source, [{ ...source, uri: 'spotify:track:live', title: 'Тихая ночь Live' }])
    expect(result.decision).toBe('review_required')
    expect(result.evidence).toContain('VERSION_CONFLICT')
  })

  it('accepts a transliterated Cyrillic match', () => {
    const result = evaluateCandidates({
      ...source,
      title: 'Группа крови',
      artists: ['Кино'],
      album: 'Группа крови',
    }, [{
      ...source,
      uri: 'spotify:track:latin',
      title: 'Gruppa krovi',
      artists: ['Kino'],
      album: 'Gruppa krovi',
    }])
    expect(result.decision).toBe('accepted')
    expect(result.candidate?.uri).toBe('spotify:track:latin')
  })

  it('accepts artist spelling and credit variants without accepting a wrong artist', () => {
    const samples = [
      {
        source: { ...source, title: 'Колесница', artists: ['хмыров'], album: 'Ярмарка', durationMs: 180_000 },
        candidate: { ...source, uri: 'spotify:track:hmyrov', title: 'Колесница', artists: ['hmyrov'], album: 'Ярмарка', durationMs: 180_000 },
      },
      {
        source: { ...source, title: 'Пока-пора', artists: ['Bahroma'], album: 'Ипи', durationMs: 180_000 },
        candidate: { ...source, uri: 'spotify:track:bahroma', title: 'Пока-пора', artists: ['BAH.ROMA'], album: 'Ипи', durationMs: 180_003 },
      },
      {
        source: { ...source, title: 'наше море', artists: ['дубя'], album: 'наше море', durationMs: 180_000 },
        candidate: { ...source, uri: 'spotify:track:credits', title: 'наше море', artists: ['дубя', 'войка'], album: 'наше море', durationMs: 180_001 },
      },
      {
        source: { ...source, title: 'Freaks', artists: ['Surf Curse', 'Travis Barker'], album: 'Freaks', durationMs: 133_000 },
        candidate: { ...source, uri: 'spotify:track:freaks', title: 'Freaks', artists: ['Surf Curse'], album: 'Freaks', durationMs: 135_788 },
      },
    ]

    for (const sample of samples) {
      const result = evaluateCandidates(sample.source, [sample.candidate])
      expect(result.decision).toBe('accepted')
      expect(result.candidate?.uri).toBe(sample.candidate.uri)
    }

    const wrongArtist = evaluateCandidates({
      ...source,
      title: 'Колесница',
      artists: ['хмыров'],
      album: 'Ярмарка',
    }, [{
      ...source,
      uri: 'spotify:track:wrong-artist',
      title: 'Колесница',
      artists: ['Другой исполнитель'],
      album: 'Ярмарка',
    }])
    expect(wrongArtist.decision).toBe('review_required')
  })

  it('groups duplicate releases when Spotify changes the artist credits', () => {
    const result = evaluateCandidates({
      ...source,
      title: 'Say It',
      artists: ['Red Hot Chili Peppers'],
      album: 'Foiled',
      durationMs: 218_640,
    }, [
      {
        ...source,
        uri: 'spotify:track:say-it-album',
        title: 'Say It',
        artists: ['Red Hot Chili Peppers'],
        album: 'Foiled',
        durationMs: 218_600,
      },
      {
        ...source,
        uri: 'spotify:track:say-it-release',
        title: 'Say It',
        artists: ['Red Hot Chili Peppers', 'Guest'],
        album: 'Foiled',
        durationMs: 218_610,
      },
    ])

    expect(result.decision).toBe('accepted')
    expect(result.candidate?.uri).toBe('spotify:track:say-it-release')
    expect(result.margin).toBeGreaterThanOrEqual(0.08)
  })

  it('accepts the saved Cyrillic samples and rejects alternate versions', () => {
    const samples = [
      {
        source: {
          ...source,
          title: 'Где ты теперь и с кем',
          artists: ['Баста', 'HammAli & Navai'],
          album: 'Где ты теперь и с кем',
          durationMs: 306_490,
        },
        best: {
          ...source,
          uri: 'spotify:track:first',
          title: 'Где ты теперь и с кем',
          artists: ['Basta', 'HammAli & Navai'],
          album: 'Где ты теперь и с кем',
          durationMs: 306_493,
        },
        alternate: {
          ...source,
          uri: 'spotify:track:first-acoustic',
          title: 'Где ты теперь и с кем (Acoustic Version)',
          artists: ['Basta'],
          album: 'Акустика',
          durationMs: 142_800,
        },
      },
      {
        source: {
          ...source,
          title: 'Ты так мне необходим',
          artists: ['MONA', 'Баста'],
          album: 'Ты так мне необходим',
          durationMs: 162_000,
        },
        best: {
          ...source,
          uri: 'spotify:track:second',
          title: 'Ты так мне необходим',
          artists: ['MONA', 'Basta'],
          album: 'Ты так мне необходим',
          durationMs: 162_000,
        },
        alternate: {
          ...source,
          uri: 'spotify:track:second-acoustic',
          title: 'Ты так мне необходим (Acoustic Version)',
          artists: ['Basta', 'MONA'],
          album: 'Акустика',
          durationMs: 142_623,
        },
      },
      {
        source: {
          ...source,
          title: 'Сансара',
          artists: ['Баста', 'Диана Арбенина', 'Александр Ф. Скляр', 'Сергей Бобунец', 'SunSay', 'Скриптонит'],
          album: 'Сансара',
          durationMs: 362_710,
        },
        best: {
          ...source,
          uri: 'spotify:track:third',
          title: 'Сансара',
          artists: ['Basta', 'Diana Arbenina', 'Александр Ф. Скляр', 'Сергей Бобунец', 'SUNSAY', 'Skryptonite', 'Ант'],
          album: 'Сансара',
          durationMs: 362_718,
        },
        alternate: {
          ...source,
          uri: 'spotify:track:third-remix',
          title: 'Сансара (DFM Mix)',
          artists: ['Basta'],
          album: 'Сансара (DFM Mix)',
          durationMs: 179_428,
        },
      },
    ]

    for (const sample of samples) {
      const result = evaluateCandidates(sample.source, [sample.best, sample.alternate])
      expect(result.decision).toBe('accepted')
      expect(result.candidate?.uri).toBe(sample.best.uri)
      expect(result.margin).toBeGreaterThanOrEqual(0.08)
    }
  })
})
