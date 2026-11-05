import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const updaterHandlers: Record<string, (info?: unknown) => void> = {}
  const appHandlers: Record<string, () => void> = {}
  return {
    updaterHandlers,
    appHandlers,
    showMessageBox: vi.fn(),
    quitAndInstall: vi.fn(),
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
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showMessageBox: mocks.showMessageBox },
}))
vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (event: string, handler: (info?: unknown) => void) => { mocks.updaterHandlers[event] = handler },
    quitAndInstall: mocks.quitAndInstall,
    checkForUpdates: () => Promise.resolve(),
  },
}))
vi.mock('../../shared/brand', () => ({
  BRAND: { id: 'polenta', productName: 'Polenta', update: { provider: 'github' } },
}))
vi.mock('../app-version', () => ({ appVersion: () => '0.2.0' }))
vi.mock('./mcp-server-processes', () => ({ findMcpServerPids: mocks.find, stopProcesses: mocks.stop }))

import { UpdateService } from './update.service'
import type { AppSettingsService } from './app-settings.service'

function readyService(): UpdateService {
  const settings = { get: () => ({ autoCheckUpdates: true }) } as unknown as AppSettingsService
  const service = new UpdateService(settings)
  service.scheduleStartupCheck(60_000)
  mocks.updaterHandlers['update-downloaded']!({ version: '0.3.0' })
  return service
}

describe('GH293 — mise à jour et serveurs MCP encore lancés', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.stop.mockImplementation(() => {})
  })

  it('sans serveur MCP : installe sans dialogue', async () => {
    mocks.find.mockReturnValue([])
    await readyService().install()
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(mocks.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('avec serveur MCP et confirmation : arrête le serveur AVANT de lancer l\'installeur', async () => {
    mocks.find.mockReturnValue([11, 22])
    mocks.showMessageBox.mockResolvedValue({ response: 0 })
    await readyService().install()
    expect(mocks.showMessageBox.mock.calls[0]![0].message).toContain('2 serveurs MCP')
    expect(mocks.stop).toHaveBeenCalledWith([11, 22])
    expect(mocks.stop.mock.invocationCallOrder[0]!).toBeLessThan(mocks.quitAndInstall.mock.invocationCallOrder[0]!)
  })

  it('« Annuler » : ni arrêt ni installation, la mise à jour reste proposée', async () => {
    mocks.find.mockReturnValue([11])
    mocks.showMessageBox.mockResolvedValue({ response: 1 })
    const service = readyService()
    await service.install()
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.quitAndInstall).not.toHaveBeenCalled()
    expect(service.getState().status).toBe('ready')
  })

  it('fermeture de l\'app avec une mise à jour prête : arrête les serveurs sans dialogue', () => {
    mocks.find.mockReturnValue([11])
    readyService()
    mocks.appHandlers['will-quit']!()
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(mocks.stop).toHaveBeenCalledWith([11])
  })

  it('fermeture sans mise à jour prête : ne touche à aucun serveur MCP', () => {
    const settings = { get: () => ({ autoCheckUpdates: true }) } as unknown as AppSettingsService
    new UpdateService(settings).scheduleStartupCheck(60_000)
    mocks.updaterHandlers['update-available']!({ version: '0.3.0' })
    mocks.appHandlers['will-quit']!()
    expect(mocks.find).not.toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('fermeture après install() : ne refait pas la détection', async () => {
    mocks.find.mockReturnValue([])
    await readyService().install()
    mocks.find.mockClear()
    mocks.appHandlers['will-quit']!()
    expect(mocks.find).not.toHaveBeenCalled()
  })
})
