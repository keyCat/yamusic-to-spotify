<script setup lang="ts">
import type { ProviderStatus, YandexAuthorization } from '../../shared/transfer-api'

defineProps<{
  status: ProviderStatus | null
  yandexAuthorization: YandexAuthorization | null
  yandexPending: boolean
  yandexMessage: string
  yandexTokenInput: string
  accountActionPending: boolean
  accountMessage: string
}>()

const emit = defineEmits<{
  disconnectSpotify: []
  startYandexAuthorization: []
  disconnectYandex: [identity: string]
  checkYandexAuthorization: []
  connectYandexWithToken: []
  'update:yandexTokenInput': [value: string]
  deleteTransferData: []
}>()
</script>

<template>
      <aside class="rounded-3xl border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/30 sm:p-8">
        <h2 class="text-lg font-bold">Подключения</h2>
        <div class="mt-6 space-y-4">
          <div class="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="font-bold">Spotify</p>
                <p class="mt-1 text-sm leading-6 text-white/55">
                  {{ status?.spotify.connected ? `Подключен аккаунт ${status.spotify.identity}.` : status?.spotify.configured ? 'Приложение готово к авторизации.' : 'Требуется настройка приложения Spotify.' }}
                </p>
                <a
                  v-if="status?.spotify.configured && !status.spotify.connected"
                  href="/api/auth/spotify/start"
                  class="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[#1db954] px-4 text-sm font-bold text-black hover:bg-[#35d26b]"
                >
                  Подключить Spotify
                </a>
                <button
                  v-if="status?.spotify.connected"
                  type="button"
                  :disabled="accountActionPending"
                  class="mt-3 min-h-9 rounded-lg border border-white/15 px-3 text-xs font-bold text-white/65 disabled:opacity-40"
                  @click="emit('disconnectSpotify')"
                >
                  Отключить Spotify
                </button>
              </div>
              <span class="mt-1 size-3 shrink-0 rounded-full" :class="status?.spotify.connected ? 'bg-[#1db954]' : 'bg-white/25'" />
            </div>
          </div>

          <div class="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="font-bold">Яндекс Музыка</p>
                <p class="mt-1 text-sm leading-6 text-white/55">
                  {{ status?.yandex.connections.length ? `Подключен аккаунт ${status.yandex.connections[0]?.identity}.` : 'Публичные ссылки доступны. Подключите аккаунт для приватных плейлистов.' }}
                </p>
                <button
                  v-if="status?.spotify.connected && !status.yandex.connections.length && !yandexAuthorization"
                  type="button"
                  :disabled="yandexPending"
                  class="mt-3 min-h-10 rounded-lg bg-[#ffcc00] px-4 text-sm font-bold text-black hover:bg-[#ffda40] disabled:opacity-60"
                  @click="emit('startYandexAuthorization')"
                >
                  Подключить Яндекс Музыку
                </button>
                <button
                  v-if="status?.yandex.connections[0]"
                  type="button"
                  :disabled="accountActionPending"
                  class="mt-3 min-h-9 rounded-lg border border-white/15 px-3 text-xs font-bold text-white/65 disabled:opacity-40"
                  @click="emit('disconnectYandex', status.yandex.connections[0].identity)"
                >
                  Отключить Яндекс Музыку
                </button>
              </div>
              <span class="mt-1 size-3 shrink-0 rounded-full" :class="status?.yandex.connections.length ? 'bg-[#ffcc00]' : 'bg-white/25'" />
            </div>
            <div v-if="yandexAuthorization" class="mt-4 rounded-xl border border-[#ffcc00]/30 bg-[#ffcc00]/8 p-4">
              <p class="text-sm text-white/65">Откройте страницу Яндекса. Введите этот код:</p>
              <p class="my-3 font-mono text-2xl font-black tracking-[0.2em]">{{ yandexAuthorization.userCode }}</p>
              <div class="flex flex-wrap gap-2">
                <a
                  :href="yandexAuthorization.verificationUrl"
                  target="_blank"
                  rel="noreferrer"
                  class="inline-flex min-h-10 items-center rounded-lg bg-[#ffcc00] px-4 text-sm font-bold text-black"
                >
                  Открыть Яндекс
                </a>
                <button
                  type="button"
                  :disabled="yandexPending"
                  class="min-h-10 rounded-lg border border-white/15 px-4 text-sm font-bold text-white disabled:opacity-60"
                  @click="emit('checkYandexAuthorization')"
                >
                  Проверить
                </button>
              </div>
            </div>
            <details
              v-if="status?.spotify.connected && !status.yandex.connections.length"
              class="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <summary class="cursor-pointer text-sm font-bold text-white/70">Код не работает</summary>
              <div class="mt-4 space-y-3 text-sm leading-6 text-white/60">
                <p class="text-amber-200">Ссылка содержит секретный токен. Не отправляйте ее другим людям.</p>
                <ol class="list-decimal space-y-1 pl-5">
                  <li>Откройте запасную авторизацию в браузере с нужным аккаунтом.</li>
                  <li>Разрешите доступ к аккаунту.</li>
                  <li>Скопируйте полный адрес страницы после перехода в Яндекс Музыку.</li>
                  <li>Вставьте адрес в поле ниже.</li>
                </ol>
                <a
                  href="/api/auth/yandex/token-start"
                  target="_blank"
                  rel="noreferrer"
                  class="inline-flex min-h-10 items-center rounded-lg border border-[#ffcc00]/50 px-4 font-bold text-[#ffcc00]"
                >
                  Открыть запасную авторизацию
                </a>
                <form class="space-y-2" @submit.prevent="emit('connectYandexWithToken')">
                  <label for="yandex-token" class="block font-bold text-white/70">Ссылка или токен</label>
                  <input
                    id="yandex-token"
                    :value="yandexTokenInput" @input="emit('update:yandexTokenInput', ($event.target as HTMLInputElement).value)"
                    type="password"
                    name="yandex-token"
                    autocomplete="off"
                    spellcheck="false"
                    required
                    class="min-h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none focus:border-[#ffcc00]/70"
                    placeholder="https://music.yandex.ru/#access_token=..."
                  >
                  <button
                    type="submit"
                    :disabled="yandexPending || !yandexTokenInput.trim()"
                    class="min-h-10 rounded-lg bg-[#ffcc00] px-4 font-bold text-black disabled:opacity-60"
                  >
                    Подключить через токен
                  </button>
                </form>
              </div>
            </details>
            <p v-if="yandexMessage" role="status" class="mt-3 text-sm text-white/65">{{ yandexMessage }}</p>
          </div>
        </div>

        <div class="mt-7 border-t border-white/10 pt-6">
          <p class="text-sm leading-6 text-white/50">
            Сервис создаст новые приватные плейлисты. Он не изменит данные в Яндекс Музыке.
          </p>
          <button
            v-if="status?.spotify.connected"
            type="button"
            :disabled="accountActionPending"
            class="mt-4 min-h-9 rounded-lg border border-red-400/35 px-3 text-xs font-bold text-red-200 disabled:opacity-40"
            @click="emit('deleteTransferData')"
          >
            Удалить сохраненные задания
          </button>
          <p v-if="accountMessage" role="status" class="mt-3 text-sm text-white/65">{{ accountMessage }}</p>
        </div>
      </aside>
</template>
