import { ref } from 'vue'
import type { YandexAuthorization } from '../../shared/transfer-api'

type ConnectionCallbacks = {
  loadYandexCollections: () => Promise<void>
  clearCollections: () => void
  clearTransferData: () => void
}

export function useConnections(callbacks: ConnectionCallbacks) {
  const yandexAuthorization = ref<YandexAuthorization | null>(null)
  const yandexPending = ref(false)
  const yandexMessage = ref('')
  const yandexTokenInput = ref('')
  const accountActionPending = ref(false)
  const accountMessage = ref('')

  async function startYandexAuthorization() {
    yandexPending.value = true
    yandexMessage.value = ''
    try {
      yandexAuthorization.value = await $fetch<YandexAuthorization>('/api/auth/yandex/start', { method: 'POST' })
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      yandexMessage.value = response.data?.statusMessage || 'Не удалось начать подключение.'
    } finally {
      yandexPending.value = false
    }
  }

  async function checkYandexAuthorization() {
    if (!yandexAuthorization.value) return
    yandexPending.value = true
    yandexMessage.value = ''
    try {
      const result = await $fetch<{ status: 'pending' | 'connected', identity?: string }>('/api/auth/yandex/poll', {
        method: 'POST',
        body: { authorizationId: yandexAuthorization.value.authorizationId },
      })
      if (result.status === 'connected') {
        yandexMessage.value = `Подключен аккаунт ${result.identity}.`
        yandexAuthorization.value = null
        await refreshNuxtData()
        await callbacks.loadYandexCollections()
      } else {
        yandexMessage.value = 'Яндекс еще ожидает подтверждение.'
      }
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      yandexMessage.value = response.data?.statusMessage || 'Не удалось проверить подключение.'
    } finally {
      yandexPending.value = false
    }
  }

  async function connectYandexWithToken() {
    yandexPending.value = true
    yandexMessage.value = ''
    try {
      const result = await $fetch<{ status: 'connected', identity: string }>('/api/auth/yandex/token', {
        method: 'POST',
        body: { tokenInput: yandexTokenInput.value },
      })
      yandexTokenInput.value = ''
      yandexAuthorization.value = null
      yandexMessage.value = `Подключен аккаунт ${result.identity}.`
      await refreshNuxtData()
      await callbacks.loadYandexCollections()
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      yandexMessage.value = response.data?.statusMessage || 'Не удалось подключить аккаунт через токен.'
    } finally {
      yandexPending.value = false
    }
  }

  async function disconnectSpotify() {
    if (!window.confirm('Отключить Spotify? Все активные задания будут приостановлены.')) return
    accountActionPending.value = true
    accountMessage.value = ''
    try {
      await $fetch('/api/accounts/spotify/disconnect', { method: 'POST' })
      window.location.assign('/')
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      accountMessage.value = response.data?.statusMessage || 'Не удалось отключить Spotify.'
      accountActionPending.value = false
    }
  }

  async function disconnectYandex(identity: string) {
    if (!window.confirm(`Отключить аккаунт ${identity}?`)) return
    accountActionPending.value = true
    accountMessage.value = ''
    try {
      await $fetch('/api/accounts/yandex/disconnect', { method: 'POST', body: { identity } })
      callbacks.clearCollections()
      await refreshNuxtData()
      accountMessage.value = 'Аккаунт Яндекс Музыки отключен.'
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      accountMessage.value = response.data?.statusMessage || 'Не удалось отключить Яндекс Музыку.'
    } finally {
      accountActionPending.value = false
    }
  }

  async function deleteTransferData() {
    if (!window.confirm('Удалить все сохраненные задания переноса?')) return
    accountActionPending.value = true
    accountMessage.value = ''
    try {
      await $fetch('/api/data/delete', { method: 'POST' })
      callbacks.clearTransferData()
      accountMessage.value = 'Сохраненные задания удалены.'
    } catch (error) {
      const response = error as { data?: { statusMessage?: string } }
      accountMessage.value = response.data?.statusMessage || 'Не удалось удалить сохраненные задания.'
    } finally {
      accountActionPending.value = false
    }
  }

  return {
    yandexAuthorization,
    yandexPending,
    yandexMessage,
    yandexTokenInput,
    accountActionPending,
    accountMessage,
    startYandexAuthorization,
    checkYandexAuthorization,
    connectYandexWithToken,
    disconnectSpotify,
    disconnectYandex,
    deleteTransferData,
  }
}
