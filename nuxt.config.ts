import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  nitro: {
    preset: 'node-server',
  },
  runtimeConfig: {
    dataDir: process.env.NUXT_DATA_DIR || './data',
    encryptionKey: process.env.NUXT_ENCRYPTION_KEY || '',
    spotifyClientId: process.env.NUXT_SPOTIFY_CLIENT_ID || '',
    spotifyRedirectUri: process.env.NUXT_SPOTIFY_REDIRECT_URI || '',
    spotifyMarket: process.env.NUXT_SPOTIFY_MARKET || 'SG',
    allowedSpotifyUsers: process.env.NUXT_ALLOWED_SPOTIFY_USERS || '',
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
