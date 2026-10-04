export type DesktopSettingsDto = {
  spotifyClientId: string
}

export type DesktopApi = {
  readSettings: () => Promise<DesktopSettingsDto>
  updateSettings: (settings: DesktopSettingsDto) => Promise<void>
  connectSpotify: () => Promise<void>
}

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}
