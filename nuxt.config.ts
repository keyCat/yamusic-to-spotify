import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Музыка без границ',
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
    },
  },
  nitro: {
    preset: 'node-server',
  },
  runtimeConfig: {
    dataDir: './data',
    encryptionKey: '',
    spotifyClientId: '',
    spotifyRedirectUri: '',
    spotifyMarket: 'SG',
    allowedSpotifyUsers: '',
    desktopLaunchSecret: '',
    desktopWindowSecret: '',
    public: {
      appName: 'Музыка без границ',
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
