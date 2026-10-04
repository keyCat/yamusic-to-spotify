<script setup lang="ts">
import type { DesktopSettingsDto } from '../../shared/desktop-api'

const emit = defineEmits<{ completed: [] }>()
const isLoading = ref(true)
const isSaving = ref(false)
const settings = ref<DesktopSettingsDto>({ spotifyClientId: '' })
const savedClientId = ref('')
const hasUnsavedChanges = computed(() => settings.value.spotifyClientId.trim() !== savedClientId.value)
const message = ref('')
onMounted(async () => {
  if (!window.desktopApi) return
  try {
    settings.value = await window.desktopApi.readSettings()
    savedClientId.value = settings.value.spotifyClientId
  } catch { message.value = 'Не удалось прочитать настройки. Перезапустите приложение.' }
  finally { isLoading.value = false }
})
async function updateSettings() {
  if (isLoading.value || isSaving.value || !/^[a-fA-F0-9]{32}$/.test(settings.value.spotifyClientId.trim())) return
  if (!hasUnsavedChanges.value) {
    emit('completed')
    return
  }
  isSaving.value = true
  message.value = ''
  try {
    await window.desktopApi!.updateSettings({
      spotifyClientId: settings.value.spotifyClientId.trim(),
    })
    message.value = 'Настройки сохранены. Приложение перезапускает сервер.'
  } catch (error) {
    message.value = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Не удалось сохранить настройки.'
  } finally { isSaving.value = false }
}
</script>

<template>
  <section class="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-8">
    <h2 class="text-xl font-bold">Настройки приложения</h2>
    <form class="mt-4 space-y-4" @submit.prevent="updateSettings">
      <p class="text-sm leading-6 text-white/65">Создайте приложение в <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" class="text-[#1db954] underline">Spotify Developer Dashboard</a> и скопируйте Client ID. В настройках Spotify выберите Web API и добавьте Redirect URI:</p>
      <code class="block break-all rounded-lg bg-black/30 p-3 text-sm">http://127.0.0.1/api/auth/spotify/callback</code>
      <p class="text-sm text-white/55">Порт указывать не нужно: Spotify разрешает динамический порт для loopback-адреса. Добавьте свой Spotify-аккаунт в список пользователей приложения, если оно работает в Development Mode.</p>
      <label class="block text-sm font-bold">Spotify Client ID
        <input v-model="settings.spotifyClientId" :disabled="isLoading || isSaving" required pattern="[a-fA-F0-9]{32}" maxlength="32" autocomplete="off" spellcheck="false" class="mt-2 block w-full rounded-lg border border-white/15 bg-black/25 p-3 font-mono disabled:opacity-50" placeholder="32 символа из Spotify Dashboard">
      </label>
      <p class="text-sm text-white/55">Для изменения Client ID сначала отключите Spotify в панели подключений. Затем сохраните настройки и подключите аккаунт снова. Client Secret не требуется.</p>
      <button type="submit" :disabled="isLoading || isSaving" class="rounded-lg bg-[#ffcc00] px-4 py-3 font-bold text-black disabled:opacity-50">{{ isSaving ? 'Сохранение…' : savedClientId && !hasUnsavedChanges ? 'Продолжить' : 'Сохранить и продолжить' }}</button>
      <p v-if="message" role="status" class="text-sm text-amber-200">{{ message }}</p>
    </form>
  </section>
</template>
