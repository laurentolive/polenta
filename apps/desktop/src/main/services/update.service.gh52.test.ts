import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@polenta/types'

const mocks = vi.hoisted(() => {
  const updaterHandlers: Record<string, (info?: unknown) => void> = {}
  return {
    updaterHandlers,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve<{ isUpdateAvailable: boolean } | null>({ isUpdateAvailable: true })),
    send: vi.fn(),
    windows: [] as { webContents: { id: number; send: (...a: unknown[]) => void }; isDestroyed: () => boolean; isVisible: () => boolean }[],
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.2.0', on: () => {} },
  BrowserWindow: { getAllWindows: () => mocks.windows },
}))
vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (event: string, handler: (info?: unknown) => void) => { mocks.updaterHandlers[event] = handler },
    quitAndInstall: vi.fn(),
    checkForUpdates: mocks.checkForUpdates,
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    setFeedURL: mocks.setFeedURL,
  },
}))
vi.mock('../../shared/brand', () => ({
  BRAND: { id: 'polenta', productName: 'Polenta', update: { provider: 'github' }, releasesUrl: 'https://github.com/o/r/releases' },
}))
vi.mock('../app-version', () => ({ appVersion: () => '0.2.0' }))
vi.mock('./mcp-server-processes', () => ({ findMcpServerPids: () => [], stopProcesses: () => {} }))

import { UpdateService } from './update.service'
import type { AppSettingsService } from './app-settings.service'

const FEED = 'https://forge.client.fr/polenta-updates/'

function settings(autoCheckUpdates = false): AppSettingsService {
  const current: AppSettings = { autoCheckUpdates }
  return {
    get: () => current,
    onChange: () => () => {},
  } as unknown as AppSettingsService
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllTimers()
  vi.clearAllMocks()
  mocks.windows = []
  mocks.checkForUpdates.mockImplementation(() => Promise.resolve({ isUpdateAvailable: true }))
})

describe('GH52 — flux de mise à jour du serveur du client', () => {
  it('U-U1 : avec updateFeedUrl, le flux generic est fixé avant la première vérification', () => {
    const service = new UpdateService(settings(), FEED)
    service.scheduleStartupCheck(1000)
    vi.advanceTimersByTime(1000)
    expect(mocks.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: FEED })
    const setOrder = mocks.setFeedURL.mock.invocationCallOrder[0]!
    const checkOrder = mocks.checkForUpdates.mock.invocationCallOrder[0]!
    expect(setOrder).toBeLessThan(checkOrder)
  })

  it('U-U2 : sans updateFeedUrl, aucun changement de source (comportement d\'origine)', () => {
    const service = new UpdateService(settings())
    service.scheduleStartupCheck(1000)
    vi.advanceTimersByTime(1000)
    expect(mocks.setFeedURL).not.toHaveBeenCalled()
    expect(mocks.checkForUpdates).toHaveBeenCalled()
  })

  it('U-U3 : avec le flux, aucune source GitHub n\'est fixée', () => {
    const service = new UpdateService(settings(), FEED)
    service.scheduleStartupCheck(1000)
    vi.advanceTimersByTime(1000)
    for (const [arg] of mocks.setFeedURL.mock.calls) {
      expect((arg as { provider: string }).provider).not.toBe('github')
    }
  })

  it('U-U6 : le lien vers les notes GitHub n\'est pas proposé quand le flux est celui du serveur', () => {
    const service = new UpdateService(settings(), FEED)
    service.scheduleStartupCheck(1000)
    vi.advanceTimersByTime(1000)
    mocks.updaterHandlers['update-available']!({ version: '0.3.0' })
    expect(service.getState()).toEqual(expect.objectContaining({ status: 'available', availableVersion: '0.3.0' }))
    expect(service.getState().releaseUrl).toBeUndefined()
  })

  it('sans flux : le lien vers la page GitHub de la version reste proposé (non-régression)', () => {
    const service = new UpdateService(settings())
    service.scheduleStartupCheck(1000)
    vi.advanceTimersByTime(1000)
    mocks.updaterHandlers['update-available']!({ version: '0.3.0' })
    expect(service.getState().releaseUrl).toBe('https://github.com/o/r/releases/tag/v0.3.0')
  })
})
