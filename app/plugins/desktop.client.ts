export default defineNuxtPlugin(() => {
  if (!window.desktopApi) return
  const message = useState('desktop-authorization-message', () => '')
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null
    if (!anchor || new URL(anchor.href).origin !== location.origin
      || new URL(anchor.href).pathname !== '/api/auth/spotify/start') return
    event.preventDefault()
    message.value = 'Завершите подключение Spotify в открывшемся браузере. После подключения приложение обновится.'
    void window.desktopApi!.connectSpotify().catch(error => {
      message.value = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Не удалось подключить Spotify.'
    })
  })
})
