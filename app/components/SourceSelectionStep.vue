<script setup lang="ts">
import type { MatchingJob, PlaylistResult, ProviderStatus, YandexCollectionsResult } from '../../shared/transfer-api'

defineProps<{
  status: ProviderStatus | null
  matchingJob: MatchingJob | null
  jobControlPending: boolean
  collectionsPending: boolean
  collectionsResult: YandexCollectionsResult | null
  pending: boolean
  selectedCollectionId: string
  collectionsMessage: string
  playlistUrl: string
  errorMessage: string
  playlist: PlaylistResult['playlist'] | null
  canStartSearch: boolean
  inspectedPublicPlaylistUrl: string
}>()

const emit = defineEmits<{
  continue: []
  restart: []
  loadCollections: []
  inspectCollection: [id: string]
  inspectPlaylist: []
  startMatching: []
  startPublicMatching: []
  'update:playlistUrl': [value: string]
}>()
</script>

<template>
        <div>
        <p class="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-[#ffcc00]">Источник музыки</p>
        <h2 class="max-w-2xl text-4xl font-black leading-tight sm:text-5xl">Выберите плейлист для переноса</h2>
        <p class="mt-5 max-w-xl text-lg leading-8 text-white/62">
          Сервис сохранит порядок композиций и повторные записи. Вы проверите все спорные совпадения до переноса.
        </p>

        <section v-if="matchingJob?.canRestart" class="mt-8 rounded-2xl border border-[#ffcc00]/30 bg-[#ffcc00]/8 p-5">
          <p class="text-sm font-bold uppercase tracking-[0.14em] text-[#ffdc59]">Текущее задание</p>
          <h3 class="mt-2 text-xl font-bold">{{ matchingJob.name }}</h3>
          <p class="mt-2 text-sm text-white/60">Продолжите текущее задание. Вы также можете повторить поиск для этого плейлиста.</p>
          <div class="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              class="min-h-11 rounded-xl bg-[#ffcc00] px-5 font-extrabold text-black"
              @click="emit('continue')"
            >
              Продолжить текущее задание
            </button>
            <button
              type="button"
              :disabled="jobControlPending"
              class="min-h-11 rounded-xl border border-white/15 px-5 font-bold text-white disabled:opacity-40"
              @click="emit('restart')"
            >
              {{ jobControlPending ? 'Подготовка…' : 'Повторить поиск' }}
            </button>
          </div>
        </section>

        <section v-if="status?.yandex.connections.length" class="mt-10">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-bold">Моя медиатека</p>
              <p class="mt-1 text-sm text-white/50">Выберите приватный плейлист или любимые треки.</p>
            </div>
            <button
              type="button"
              :disabled="collectionsPending"
              class="min-h-10 rounded-lg border border-white/15 px-4 text-sm font-bold text-white disabled:opacity-60"
              @click="emit('loadCollections')"
            >
              {{ collectionsPending ? 'Загрузка…' : 'Обновить' }}
            </button>
          </div>
          <div v-if="collectionsResult?.collections.length" class="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              v-for="collection in collectionsResult.collections"
              :key="collection.id"
              type="button"
              :disabled="pending"
              class="rounded-2xl border p-4 text-left transition disabled:opacity-60"
              :class="selectedCollectionId === collection.id ? 'border-[#ffcc00]/70 bg-[#ffcc00]/10' : 'border-white/10 bg-white/[0.04] hover:border-white/25'"
            @click="emit('inspectCollection', collection.id)"
          >
              <span class="flex items-center gap-3">
                <TrackCover :url="collection.coverUrl" :alt="`Обложка Яндекс Музыки: ${collection.name}`" provider="yandex" size="sm" />
                <span>
                  <span class="block font-bold">{{ collection.name }}</span>
                  <span class="mt-1 block text-sm text-white/55">Треков: {{ collection.trackCount }}</span>
                </span>
              </span>
            </button>
          </div>
          <p v-if="collectionsMessage" role="alert" class="mt-3 text-sm font-semibold text-red-300">{{ collectionsMessage }}</p>
        </section>

        <form class="mt-10 border-t border-white/10 pt-8" @submit.prevent="emit('inspectPlaylist')">
          <label for="playlist-url" class="mb-2 block text-sm font-bold">Ссылка на публичный плейлист</label>
          <div class="flex flex-col gap-3 sm:flex-row">
            <input
              id="playlist-url"
              :value="playlistUrl" @input="emit('update:playlistUrl', ($event.target as HTMLInputElement).value)"
              required
              type="url"
              inputmode="url"
              autocomplete="url"
              placeholder="https://music.yandex.ru/users/.../playlists/..."
              class="min-h-12 flex-1 rounded-xl border border-white/15 bg-white/6 px-4 text-base text-white placeholder:text-white/30"
            >
            <button
              type="submit"
              :disabled="pending"
              class="min-h-12 rounded-xl bg-[#ffcc00] px-6 font-extrabold text-black transition hover:bg-[#ffda40] disabled:cursor-wait disabled:opacity-60"
            >
              {{ pending ? 'Проверка…' : 'Проверить' }}
            </button>
          </div>
          <p v-if="errorMessage" role="alert" class="mt-3 text-sm font-semibold text-red-300">{{ errorMessage }}</p>
        </form>

        <article v-if="playlist" class="mt-6 rounded-2xl border border-[#ffcc00]/35 bg-[#ffcc00]/8 p-5">
          <div class="flex items-center gap-4">
            <TrackCover :url="playlist.coverUrl" :alt="`Обложка Яндекс Музыки: ${playlist.name}`" provider="yandex" />
            <div>
              <p class="text-sm font-semibold text-[#ffdc59]">Плейлист доступен</p>
              <h3 class="mt-1 text-xl font-bold">{{ playlist.name }}</h3>
              <p class="mt-2 text-white/65">Владелец: {{ playlist.owner }} · Композиций: {{ playlist.returnedTrackCount }}</p>
            </div>
          </div>
          <p v-if="playlist.declaredTrackCount !== playlist.returnedTrackCount" class="mt-3 text-sm text-red-300">
            Ответ содержит не все композиции. Перенос недоступен до полной загрузки.
          </p>
          <ol v-if="playlist.tracks?.length" class="mt-4 space-y-2 border-t border-[#ffcc00]/20 pt-4 text-sm">
            <li v-for="track in playlist.tracks.slice(0, 5)" :key="`${track.position}:${track.id}`" class="flex items-center gap-3">
              <span class="w-6 shrink-0 text-right text-white/35">{{ track.position + 1 }}</span>
              <TrackCover :url="track.coverUrl" :alt="`Обложка Яндекс Музыки: ${track.title}`" provider="yandex" size="sm" />
              <span>
                <span class="font-semibold">{{ track.title }}</span>
                <span class="text-white/50"> — {{ track.artists.join(', ') }}</span>
              </span>
            </li>
          </ol>
          <p v-if="playlist.tracks && playlist.tracks.length > 5" class="mt-3 text-sm text-white/45">
            Показаны первые 5 треков.
          </p>
          <button
            v-if="selectedCollectionId && canStartSearch"
            type="button"
            class="mt-5 min-h-11 rounded-xl bg-[#ffcc00] px-5 font-extrabold text-black hover:bg-[#ffda40]"
            @click="emit('startMatching')"
          >
            {{ matchingJob ? 'Начать новый поиск' : 'Найти совпадения в Spotify' }}
          </button>
          <button
            v-if="inspectedPublicPlaylistUrl && status?.spotify.connected && canStartSearch"
            type="button"
            class="mt-5 min-h-11 rounded-xl bg-[#ffcc00] px-5 font-extrabold text-black hover:bg-[#ffda40]"
            @click="emit('startPublicMatching')"
          >
            {{ matchingJob ? 'Начать новый поиск' : 'Найти совпадения в Spotify' }}
          </button>
        </article>
        </div>

</template>
