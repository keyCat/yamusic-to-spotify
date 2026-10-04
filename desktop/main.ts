import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron'
import { dirname, isAbsolute, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { DesktopBackend } from './backend'
import { ensureEncryptionKey, parseDesktopSettings, readDesktopSettings, updatePrivateFile, type DesktopSettingsRecord } from './settings'
import { isAllowedExternalUrl, isReportUrl, isTrustedRendererUrl } from './security'

app.setName('YMusicToSpotify')
const profileArgument = process.argv.find(value => value.startsWith('--desktop-profile='))?.slice('--desktop-profile='.length)
const isSmokeTest = process.argv.includes('--desktop-smoke-test')
if (profileArgument) {
  if (!isAbsolute(profileArgument)) throw new Error('Desktop profile path must be absolute')
  app.setPath('userData', profileArgument)
} else {
  // Keep existing accounts, encryption keys and transfers after the display-name change.
  const existingProfilePath = join(app.getPath('appData'), 'Music Without Borders')
  mkdirSync(existingProfilePath, { recursive: true, mode: 0o700 })
  app.setPath('userData', existingProfilePath)
}
if (isSmokeTest && !profileArgument) throw new Error('Smoke checks require an isolated profile')

let window: BrowserWindow | undefined
let settings: DesktopSettingsRecord
let encryptionKey: string
let isQuitting = false
let isBackendFailed = false
let isApplicationReady = false
let isUpdatingSettings = false
let isAuthorizing = false
let authorizationGeneration = 0
const profilePath = app.getPath('userData')
const backendEntryPath = app.isPackaged
  ? join(process.resourcesPath, 'backend', 'server', 'index.mjs')
  : join(__dirname, '..', '..', 'server', 'server', 'index.mjs')
const applicationIconPath = join(dirname(backendEntryPath), '..', 'public', 'icon.png')
const backend = new DesktopBackend(() => {
  isBackendFailed = true
  window?.webContents.stop()
  void showFailure('Сервер приложения остановился. Перезапустите приложение. Данные и контрольные точки переноса сохранены.')
})

async function showFailure(message: string) {
  if (isQuitting) return
  if (isSmokeTest) {
    console.error('DESKTOP_SMOKE_FAILED')
    app.exit(1)
    return
  }
  await dialog.showMessageBox({ type: 'error', title: 'Музыка без границ', message })
  app.quit()
}

function assertTrustedSender(event: IpcMainInvokeEvent) {
  if (isQuitting || isBackendFailed || !window || event.sender !== window.webContents
    || event.senderFrame !== window.webContents.mainFrame
    || !isTrustedRendererUrl(event.senderFrame?.url || '', backend.origin)) {
    throw new Error('Недопустимый источник запроса.')
  }
}

async function openExternalUrl(value: string) {
  if (!isAllowedExternalUrl(value)) throw new Error('Эта внешняя ссылка не разрешена.')
  await shell.openExternal(value)
}

async function connectSpotify() {
  if (isAuthorizing || isUpdatingSettings) throw new Error('Дождитесь завершения текущей операции.')
  if (!settings.spotifyClientId) throw new Error('Сначала сохраните Spotify Client ID в настройках.')
  isAuthorizing = true
  const generation = ++authorizationGeneration
  try {
    const attempt = await backend.fetchJson<{ id: string, url: string }>('/api/desktop/spotify/start', {})
    await openExternalUrl(attempt.url)
    const deadlineMs = Date.now() + 600_000
    while (!isQuitting && generation === authorizationGeneration && Date.now() < deadlineMs) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const result = await backend.fetchJson<{ status: string, session?: string }>('/api/desktop/spotify/claim', { id: attempt.id })
      if (result.status === 'pending') continue
      if (result.status !== 'complete' || !result.session) throw new Error('Авторизация отменена или истекла. Повторите подключение Spotify.')
      await session.defaultSession.cookies.set({
        url: backend.origin, name: 'yamusic_session', value: result.session,
        httpOnly: true, sameSite: 'lax', path: '/', expirationDate: Date.now() / 1000 + 604_800,
      })
      await session.defaultSession.cookies.flushStore()
      await window?.loadURL(backend.origin + '/?setup=complete')
      window?.show()
      window?.focus()
      return
    }
    if (!isQuitting) throw new Error('Время ожидания авторизации истекло. Повторите подключение Spotify.')
  } finally { isAuthorizing = false }
}

async function openNavigation(value: string) {
  if (isReportUrl(value, backend.origin)) {
    window?.webContents.downloadURL(value)
    return
  }
  const url = new URL(value)
  if (url.origin === backend.origin && url.pathname === '/api/auth/spotify/start') return connectSpotify()
  if (url.origin === backend.origin && url.pathname === '/api/auth/yandex/token-start') {
    // Open the fixed provider URL directly; the browser cannot access protected app routes.
    return openExternalUrl('https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d&force_confirm=yes')
  }
  return openExternalUrl(value)
}

function onNavigationError(error: unknown) {
  if (!isQuitting) void dialog.showMessageBox({ type: 'error', title: 'Подключение', message: error instanceof Error ? error.message : 'Не удалось открыть ссылку.' })
}

async function openWindow() {
  if (window) { window.show(); window.focus(); return }
  window = new BrowserWindow({
    width: 1200, height: 850, minWidth: 760, minHeight: 600,
    title: 'Музыка без границ', backgroundColor: '#111111', show: false,
    icon: applicationIconPath,
    webPreferences: {
      preload: join(__dirname, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  const currentWindow = window
  currentWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openNavigation(url).catch(onNavigationError)
    return { action: 'deny' }
  })
  currentWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url, backend.origin)) return
    event.preventDefault()
    void openNavigation(url).catch(onNavigationError)
  })
  currentWindow.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, backend.origin)) event.preventDefault()
  })
  currentWindow.webContents.on('will-attach-webview', event => event.preventDefault())
  currentWindow.webContents.on('render-process-gone', () => {
    if (!isQuitting) void showFailure('Окно приложения остановилось. Перезапустите приложение.')
  })
  currentWindow.on('closed', () => { if (window === currentWindow) window = undefined })
  await currentWindow.loadURL(backend.origin)
  if (!isSmokeTest) currentWindow.show()
}

async function startApplication() {
  // Development runs inside Electron.app; packaged builds use their bundled ICNS.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(applicationIconPath)
  settings = await readDesktopSettings(profilePath)
  encryptionKey = await ensureEncryptionKey(profilePath, {
    isAvailable: () => safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value),
    confirmFileStorage: async () => {
      const result = await dialog.showMessageBox({
        type: 'warning', title: 'Хранение ключа',
        message: 'Системное хранилище ключей недоступно.',
        detail: 'Можно установить и разблокировать системную связку ключей либо сохранить ключ в закрытом файле профиля без дополнительного шифрования. Доступ к профилю позволит прочитать токены Spotify и Яндекса.',
        buttons: ['Завершить и настроить хранилище', 'Сохранить в закрытом файле'], defaultId: 0, cancelId: 0,
      })
      return result.response === 1
    },
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    for (const name of Object.keys(headers)) {
      if (['x-desktop-window', 'x-desktop-secret'].includes(name.toLowerCase())) delete headers[name]
    }
    if (new URL(details.url).origin === backend.origin) headers['x-desktop-window'] = backend.windowSecret
    callback({ requestHeaders: headers })
  })
  session.defaultSession.on('will-download', (event, item) => {
    const url = new URL(item.getURL())
    if (!isReportUrl(url.href, backend.origin)) {
      event.preventDefault()
      return
    }
    item.setSaveDialogOptions({ title: 'Сохранить отчет', defaultPath: item.getFilename() })
    item.once('done', (_event, state) => {
      if (state === 'interrupted' && !isQuitting) void dialog.showMessageBox({ type: 'error', message: 'Отчет не удалось сохранить. Повторите скачивание.' })
    })
  })
  ipcMain.handle('desktop:read-settings', event => {
    assertTrustedSender(event)
    return { spotifyClientId: settings.spotifyClientId }
  })
  ipcMain.handle('desktop:connect-spotify', async event => { assertTrustedSender(event); await connectSpotify() })
  ipcMain.handle('desktop:update-settings', async (event, input: unknown) => {
    assertTrustedSender(event)
    if (isUpdatingSettings || isAuthorizing) throw new Error('Дождитесь завершения текущей операции.')
    isUpdatingSettings = true
    let hasRestartStarted = false
    try {
      if (!input || typeof input !== 'object') throw new Error('Некорректные настройки.')
      const record = input as Record<string, unknown>
      const nextSettings = parseDesktopSettings({ version: 1, spotifyClientId: record.spotifyClientId })
      if (nextSettings.spotifyClientId !== settings.spotifyClientId && (await backend.fetchStatus()).hasSpotifyConnection) {
        throw new Error('Отключите Spotify перед изменением Client ID. Это правило также относится к ранее подключенным аккаунтам.')
      }
      await updatePrivateFile(join(profilePath, 'settings.json'), nextSettings)
      settings = nextSettings
      hasRestartStarted = true
      isApplicationReady = false
      await backend.stop()
      await backend.start(backendEntryPath, profilePath, settings, encryptionKey)
      isApplicationReady = true
      // Respond before replacing the renderer that owns this IPC request.
      setTimeout(() => { void window?.loadURL(backend.origin + '/?setup=complete').catch(() => showFailure('Не удалось загрузить приложение. Перезапустите его.')) }, 100)
    } catch (error) {
      if (hasRestartStarted) void showFailure('Не удалось применить настройки. Перезапустите приложение.')
      throw error
    } finally { isUpdatingSettings = false }
  })
  await backend.start(backendEntryPath, profilePath, settings, encryptionKey)
  if (isQuitting) return
  isApplicationReady = true
  await openWindow()
  if (isSmokeTest) {
    if (app.getName() !== 'YMusicToSpotify') throw new Error('Desktop application name smoke check failed')
    let status = await backend.fetchStatus()
    const rendererResult = await window!.webContents.executeJavaScript(`({ hasDesktopApi: typeof window.desktopApi?.readSettings === 'function', hasNode: typeof window.require !== 'undefined', title: document.title })`)
    if (!rendererResult.hasDesktopApi || rendererResult.hasNode || status.integrity !== 'ok') throw new Error('Desktop smoke check failed')
    const rendererSettings = await window!.webContents.executeJavaScript('window.desktopApi.readSettings()')
    if (rendererSettings.spotifyClientId !== settings.spotifyClientId) throw new Error('Desktop IPC smoke check failed')
    const unauthorizedResponse = await fetch(backend.origin + '/api/status')
    if (unauthorizedResponse.status !== 403) throw new Error('Desktop HTTP boundary smoke check failed')
    const rendererPrivateStatus = await window!.webContents.executeJavaScript("fetch('/api/desktop/status').then(response => response.status)")
    if (rendererPrivateStatus !== 403) throw new Error('Desktop private endpoint smoke check failed')
    const rendererStatus = await window!.webContents.executeJavaScript("fetch('/api/status').then(response => response.json())")
    if (rendererStatus.spotify.configured !== Boolean(settings.spotifyClientId)) throw new Error('Desktop runtime config smoke check failed')
    const waitForWizard = async (step: 'settings' | 'source') => {
      await window!.webContents.executeJavaScript(`(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const activeTitle = document.querySelector('nav[aria-label="Этапы переноса"] [aria-current="step"] strong')?.textContent;
          const input = document.querySelector('input[autocomplete="off"]');
          if (activeTitle === ${JSON.stringify(step === 'settings' ? 'Настройки' : 'Источник')}
            && document.querySelectorAll('nav[aria-label="Этапы переноса"] li').length === 5
            && document.querySelector('header')?.textContent.includes(${JSON.stringify(step === 'settings' ? 'Шаг 1 из 5' : 'Шаг 2 из 5')})
            && (new URLSearchParams(location.search).get('setup') === 'complete') === ${step === 'source'}
            && (${JSON.stringify(step)} !== 'settings' || input && !input.disabled)) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Wizard did not become ready');
      })()`)
    }
    await waitForWizard('settings')
    const setupView = await window!.webContents.executeJavaScript(`({
      stepCount: document.querySelectorAll('nav[aria-label="Этапы переноса"] li').length,
      header: document.querySelector('header')?.textContent,
      hasSourceButton: Boolean(document.querySelector('button[aria-label="Перейти к шагу 2: Источник"]')),
      hasMarketInput: document.body.textContent.includes('Рынок Spotify'),
    })`)
    if (setupView.stepCount !== 5 || !setupView.header.includes('Шаг 1 из 5') || setupView.hasMarketInput
      || setupView.hasSourceButton !== Boolean(settings.spotifyClientId)) throw new Error('Desktop first step smoke check failed')
    if (settings.spotifyClientId) {
      await window!.webContents.executeJavaScript("document.querySelector('form').requestSubmit()")
      await waitForWizard('source')
      await window!.webContents.executeJavaScript(`document.querySelector('button[aria-label="Перейти к шагу 1: Настройки"]').click()`)
      await waitForWizard('settings')
    } else {
      const hasValidForm = await window!.webContents.executeJavaScript("document.querySelector('form').checkValidity()")
      if (hasValidForm) throw new Error('Desktop empty Client ID validation smoke check failed')
    }
    const nextClientId = settings.spotifyClientId === 'a'.repeat(32) ? 'b'.repeat(32) : 'a'.repeat(32)
    const didReload = new Promise<void>(resolve => window!.webContents.once('did-finish-load', () => resolve()))
    await window!.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('input[autocomplete="off"]');
      input.value = ${JSON.stringify(nextClientId)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').requestSubmit();
    })()`)
    await didReload
    await waitForWizard('source')
    status = await backend.fetchStatus()
    const nextSettings = await window!.webContents.executeJavaScript('window.desktopApi.readSettings()')
    if (nextSettings.spotifyClientId !== nextClientId) throw new Error('Desktop settings save smoke check failed')
    const hasConnectLink = await window!.webContents.executeJavaScript(`Boolean(document.querySelector('a[href="/api/auth/spotify/start"]'))`)
    if (!hasConnectLink) throw new Error('Desktop setup UI smoke check failed')
    const sourceHeader = await window!.webContents.executeJavaScript("document.querySelector('header')?.textContent")
    if (!sourceHeader.includes('Шаг 2 из 5')) throw new Error('Desktop source step numbering smoke check failed')
    await window!.webContents.executeJavaScript(`document.querySelector('button[aria-label="Перейти к шагу 1: Настройки"]').click()`)
    await waitForWizard('settings')
    const savedInput = await window!.webContents.executeJavaScript("document.querySelector('input[autocomplete=\"off\"]').value")
    if (savedInput !== nextClientId) throw new Error('Desktop settings revisit smoke check failed')
    await window!.webContents.executeJavaScript("document.querySelector('form').requestSubmit()")
    await waitForWizard('source')
    const didRefresh = new Promise<void>(resolve => window!.webContents.once('did-finish-load', () => resolve()))
    window!.webContents.reload()
    await didRefresh
    await waitForWizard('source')
    console.log(`DESKTOP_SMOKE_OK migrations=${status.migrationCount} sqlite=${status.integrity} sandbox=true`)
    app.quit()
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const onOpenWindow = () => {
    if (!isQuitting && isApplicationReady) void openWindow().catch(() => showFailure('Не удалось открыть окно.'))
  }
  app.on('second-instance', onOpenWindow)
  app.on('activate', onOpenWindow)
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' || isSmokeTest) app.quit() })
  app.on('before-quit', event => {
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    authorizationGeneration++
    void backend.stop().finally(() => app.quit())
  })
  void app.whenReady().then(startApplication).catch(error => showFailure(error instanceof Error ? error.message : 'Не удалось запустить приложение.'))
}
