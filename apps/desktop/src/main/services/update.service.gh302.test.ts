import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@polenta/types'

interface FakeWindow {
  webContents: { id: number; send: (...a: unknown[]) => void }
  isDestroyed: () => boolean
  isVisible: () => boolean
}

const mocks = vi.hoisted(() => {
  const updaterHandlers: Record<string, (info?: unknown) => void> = {}
  const appHandlers: Record<string, () => void> = {}
  return {
    updaterHandlers,
    appHandlers,
    quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve<{ isUpdateAvailable: boolean } | null>({ isUpdateAvailable: true })),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    send: vi.fn(),
    windows: [] as FakeWindow[],
    find: vi.fn<() => number[]>(),
    stop: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '0.2.0',
    on: (event: string, handler: () => void) => { mocks.appHandlers[event] = handler },
  },
  BrowserWindow: { getAllWindows: () => mocks.windows },
}))
vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (event: string, handler: (info?: unknown) => void) => { mocks.updaterHandlers[event] = handler },
    quitAndInstall: mocks.quitAndInstall,
    checkForUpdates: mocks.checkForUpdates,
    downloadUpdate: mocks.downloadUpdate,
  },
}))
vi.mock('../../shared/brand', () => ({
  BRAND: { id: 'polenta', productName: 'Polenta', update: { provider: 'github' }, releasesUrl: 'https://github.com/o/r/releases' },
}))
vi.mock('../app-version', () => ({ appVersion: () => '0.2.0' }))
vi.mock('./mcp-server-processes', () => ({ findMcpServerPids: mocks.find, stopProcesses: mocks.stop }))

import { INSTALLING_SCREEN_MS, PERIODIC_CHECK_MS, UpdateService } from './update.service'
import type { AppSettingsService } from './app-settings.service'

function fakeSettings(initial: Partial<AppSettings> = {}) {
  let current: AppSettings = { autoCheckUpdates: true, ...initial }
  const listeners: ((s: AppSettings) => void)[] = []
  return {
    service: {
      get: () => current,
      onChange: (l: (s: AppSettings) => void) => { listeners.push(l); return () => {} },
    } as unknown as AppSettingsService,
    change(patch: Partial<AppSettings>) {
      current = { ...current, ...patch }
      for (const l of listeners) l(current)
    },
  }
}

function started(settings = fakeSettings()): UpdateService {
  const service = new UpdateService(settings.service)
  service.scheduleStartupCheck(1000)
  return service
}

const emit = (event: string, info?: unknown) => mocks.updaterHandlers[event]!(info)

const win = (id: number, visible = true): FakeWindow =>
  ({ webContents: { id, send: mocks.send }, isDestroyed: () => false, isVisible: () => visible })

function ready(): UpdateService {
  const service = started()
  emit('update-available', { version: '0.3.0' })
  emit('update-downloaded', { version: '0.3.0' })
  return service
}

describe('GH302 — états de la mise à jour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Minuteries 4 h des services des tests précédents.
    vi.clearAllTimers()
    vi.clearAllMocks()
    mocks.windows = [win(1)]
    mocks.checkForUpdates.mockImplementation(() => Promise.resolve({ isUpdateAvailable: true }))
    mocks.stop.mockImplementation(() => {})
    mocks.find.mockReturnValue([])
  })

  it('U1 — disponible dès la détection, puis téléchargement automatique', () => {
    const service = started()
    emit('update-available', { version: '0.3.0' })
    expect(mocks.send).toHaveBeenCalledWith('update:state-changed', expect.objectContaining({
      status: 'available', availableVersion: '0.3.0', releaseUrl: 'https://github.com/o/r/releases/tag/v0.3.0', managed: false,
    }))
    expect(mocks.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(service.getState()).toMatchObject({ status: 'downloading', progress: 0 })
  })

  it('U2 — progression arrondie, une diffusion par pourcentage entier', () => {
    const service = started()
    emit('update-available', { version: '0.3.0' })
    mocks.send.mockClear()
    emit('download-progress', { percent: 12.4 })
    emit('download-progress', { percent: 12.9 })
    emit('download-progress', { percent: 13.1 })
    expect(mocks.send.mock.calls.map(c => (c[1] as { progress: number }).progress)).toEqual([12, 13])
    expect(service.getState()).toMatchObject({ status: 'downloading', progress: 13 })
  })

  it('U3 — téléchargée → prête, sans progression', () => {
    const service = ready()
    expect(service.getState()).toEqual({
      status: 'ready', currentVersion: '0.2.0', availableVersion: '0.3.0',
      releaseUrl: 'https://github.com/o/r/releases/tag/v0.3.0', managed: false,
    })
  })

  it('U4 — préférence décochée : vérification faite, pas de téléchargement sans clic', async () => {
    const service = started(fakeSettings({ autoCheckUpdates: false }))
    vi.advanceTimersByTime(1000)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1)
    emit('update-available', { version: '0.3.0' })
    expect(service.getState().status).toBe('available')
    expect(mocks.downloadUpdate).not.toHaveBeenCalled()
    await service.download()
    expect(mocks.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('U5 — verrou DSI / forge : vérification faite, information seule', async () => {
    const service = started(fakeSettings({ autoCheckUpdates: false, autoCheckUpdatesLocked: true }))
    vi.advanceTimersByTime(1000)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1)
    emit('update-available', { version: '0.3.0' })
    expect(service.getState()).toMatchObject({ status: 'available', managed: true })
    await service.download()
    expect(mocks.downloadUpdate).not.toHaveBeenCalled()
  })

  it('U6 — erreur sans version connue : silencieuse', () => {
    const service = started()
    emit('checking-for-update')
    emit('error', new Error('offline'))
    expect(service.getState().status).toBe('idle')
  })

  it('U7 — téléchargement interrompu : visible, « Réessayer » revérifie puis télécharge', async () => {
    const service = started(fakeSettings({ autoCheckUpdates: false }))
    emit('update-available', { version: '0.3.0' })
    await service.download()
    emit('error', new Error('net::ERR'))
    expect(service.getState().status).toBe('error')
    mocks.downloadUpdate.mockClear()
    mocks.checkForUpdates.mockClear()
    await service.download()
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(mocks.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('U7b — revérification en échec avec une version connue : état inchangé, pas d\'erreur affichée', () => {
    const service = started(fakeSettings({ autoCheckUpdates: false }))
    emit('update-available', { version: '0.3.0' })
    emit('checking-for-update')
    emit('error', new Error('offline'))
    expect(service.getState()).toMatchObject({ status: 'available', availableVersion: '0.3.0' })
  })

  it('U7c — release retirée : plus rien à proposer', () => {
    const service = started(fakeSettings({ autoCheckUpdates: false }))
    emit('update-available', { version: '0.3.0' })
    emit('update-not-available')
    expect(service.getState()).toEqual({ status: 'idle', currentVersion: '0.2.0' })
  })

  it('U7d — « Réessayer » alors que la release a été retirée : aucun téléchargement', async () => {
    const service = started(fakeSettings({ autoCheckUpdates: false }))
    emit('update-available', { version: '0.3.0' })
    mocks.checkForUpdates.mockImplementation(() => {
      emit('update-not-available')
      return Promise.resolve({ isUpdateAvailable: false })
    })
    await service.download()
    expect(mocks.downloadUpdate).not.toHaveBeenCalled()
    expect(service.getState().status).toBe('idle')
  })

  it('U5b — verrou arrivé après l\'affichage : « Télécharger » corrige l\'état sans télécharger', async () => {
    let locked = false
    const settings = {
      get: () => ({ autoCheckUpdates: false, ...(locked ? { autoCheckUpdatesLocked: true } : {}) }),
      onChange: () => () => {},
    } as unknown as AppSettingsService
    const service = new UpdateService(settings)
    service.scheduleStartupCheck(1000)
    emit('update-available', { version: '0.3.0' })
    expect(service.getState().managed).toBe(false)
    locked = true
    await service.download()
    expect(service.getState()).toMatchObject({ status: 'available', managed: true })
    expect(mocks.downloadUpdate).not.toHaveBeenCalled()
  })

  it('U8 — vérification toutes les 4 h, sautée quand la mise à jour est prête', () => {
    started()
    vi.advanceTimersByTime(1000)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PERIODIC_CHECK_MS)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2)
    emit('update-available', { version: '0.3.0' })
    emit('update-downloaded', { version: '0.3.0' })
    vi.advanceTimersByTime(PERIODIC_CHECK_MS)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('U9 — préférence cochée pendant « disponible » : téléchargement immédiat', () => {
    const settings = fakeSettings({ autoCheckUpdates: false })
    const service = started(settings)
    emit('update-available', { version: '0.3.0' })
    settings.change({ autoCheckUpdates: true })
    expect(mocks.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(service.getState().status).toBe('downloading')
  })

  it("U10 — install : écran d'installation, serveurs MCP arrêtés, installeur visible", async () => {
    mocks.find.mockReturnValue([11, 22])
    const service = ready()
    const done = service.install()
    expect(service.getState().status).toBe('installing')
    expect(mocks.quitAndInstall).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(INSTALLING_SCREEN_MS)
    await done
    expect(mocks.stop).toHaveBeenCalledWith([11, 22])
    expect(mocks.stop.mock.invocationCallOrder[0]!).toBeLessThan(mocks.quitAndInstall.mock.invocationCallOrder[0]!)
    expect(mocks.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('U10b — install hors état « prête » ou deux fois : sans effet', async () => {
    const service = started()
    await service.install()
    expect(mocks.quitAndInstall).not.toHaveBeenCalled()
    emit('update-available', { version: '0.3.0' })
    emit('update-downloaded', { version: '0.3.0' })
    const first = service.install()
    const second = service.install()
    await vi.advanceTimersByTimeAsync(INSTALLING_SCREEN_MS)
    await Promise.all([first, second])
    expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('U10c — installeur non lancé : la mise à jour reste proposée et peut être réinstallée', async () => {
    const service = ready()
    const first = service.install()
    await vi.advanceTimersByTimeAsync(INSTALLING_SCREEN_MS)
    await first
    emit('error', new Error('installer locked'))
    expect(service.getState().status).toBe('ready')
    const second = service.install()
    await vi.advanceTimersByTimeAsync(INSTALLING_SCREEN_MS)
    await second
    expect(mocks.quitAndInstall).toHaveBeenCalledTimes(2)
  })

  it('U11 — prepareInstall : serveurs MCP et autres fenêtres visibles', () => {
    // Fenêtre 4 cachée (rendu PDF, instantané draw.io) : non comptée.
    mocks.windows = [win(1), win(2), win(3), win(4, false)]
    mocks.find.mockReturnValue([11])
    expect(ready().prepareInstall(2)).toEqual({ mcpServers: 1, otherWindows: 2 })
  })

  it('GH293 — fermeture avec une mise à jour prête : arrête les serveurs MCP', () => {
    mocks.find.mockReturnValue([11])
    ready()
    mocks.appHandlers['will-quit']!()
    expect(mocks.stop).toHaveBeenCalledWith([11])
  })

  it('GH293 — fermeture sans mise à jour prête : ne touche à aucun serveur MCP', () => {
    started()
    emit('update-available', { version: '0.3.0' })
    mocks.appHandlers['will-quit']!()
    expect(mocks.find).not.toHaveBeenCalled()
  })

  it('GH293 — fermeture après install() : ne refait pas la détection', async () => {
    const service = ready()
    const done = service.install()
    await vi.advanceTimersByTimeAsync(INSTALLING_SCREEN_MS)
    await done
    mocks.find.mockClear()
    mocks.appHandlers['will-quit']!()
    expect(mocks.find).not.toHaveBeenCalled()
  })
})
