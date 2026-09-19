import { ref, type Ref } from 'vue'
import type { PlaylistResult, YandexCollectionsResult } from '../../shared/transfer-api'

export function useSourceSelection(matchingMessage: Ref<string>) {
  const playlistUrl = ref('')
  const inspectedPublicPlaylistUrl = ref('')
  const playlist = ref<PlaylistResult['playlist'] | null>(null)
  const errorMessage = ref('')
  const pending = ref(false)
  const collectionsResult = ref<YandexCollectionsResult | null>(null)
  const collectionsPending = ref(false)
  const collectionsMessage = ref('')
  const selectedCollectionId = ref('')

  async function inspectPlaylist() {
    pending.value = true
    errorMessage.value = ''
    playlist.value = null
    inspectedPublicPlaylistUrl.value = ''
    selectedCollectionId.value = ''

    try {
      const result = await $fetch<PlaylistResult>('/api/yandex/public-playlist', {
        method: 'POST',
        body: { url: playlistUrl.value },
      })
      playlist.value = result.playlist
      inspectedPublicPlaylistUrl.value = playlistUrl.value.trim()
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      errorMessage.value = response.data?.statusMessage || 'Не удалось прочитать плейлист.'
    } finally {
      pending.value = false
    }
  }

  async function loadYandexCollections() {
    collectionsPending.value = true
    collectionsMessage.value = ''
    try {
      collectionsResult.value = await $fetch<YandexCollectionsResult>('/api/yandex/collections')
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      collectionsMessage.value = response.data?.statusMessage || 'Не удалось получить медиатеку.'
    } finally {
      collectionsPending.value = false
    }
  }

  async function inspectPrivateCollection(collectionId: string) {
    if (!collectionsResult.value) return
    selectedCollectionId.value = collectionId
    inspectedPublicPlaylistUrl.value = ''
    matchingMessage.value = ''
    pending.value = true
    errorMessage.value = ''
    playlist.value = null
    try {
      const result = await $fetch<PlaylistResult>('/api/yandex/collection', {
        method: 'POST',
        body: {
          identity: collectionsResult.value.identity,
          collectionId,
        },
      })
      playlist.value = result.playlist
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      errorMessage.value = response.data?.statusMessage || 'Не удалось прочитать медиатеку.'
    } finally {
      pending.value = false
    }
  }

  function clearCollections() {
    collectionsResult.value = null
    selectedCollectionId.value = ''
  }

  function clearSourceSelection() {
    selectedCollectionId.value = ''
    inspectedPublicPlaylistUrl.value = ''
    playlist.value = null
  }

  return {
    playlistUrl,
    inspectedPublicPlaylistUrl,
    playlist,
    errorMessage,
    pending,
    collectionsResult,
    collectionsPending,
    collectionsMessage,
    selectedCollectionId,
    inspectPlaylist,
    loadYandexCollections,
    inspectPrivateCollection,
    clearCollections,
    clearSourceSelection,
  }
}
