import { z } from 'zod'

export const publicPlaylistRequestSchema = z.object({
  url: z.string().url(),
})

export type SourceTrack = {
  id: string
  title: string
  artists: string[]
  album: string | null
  coverUrl: string | null
  durationMs: number | null
  available: boolean
  position: number
}

export type SourcePlaylistSnapshot = {
  id: string
  owner: string
  revision: number | null
  name: string
  description: string
  coverUrl: string | null
  declaredTrackCount: number
  tracks: SourceTrack[]
}
