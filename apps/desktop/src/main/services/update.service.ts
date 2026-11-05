import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@polenta/types'
import type { AppSettingsService } from './app-settings.service'
import { BRAND } from '../../shared/brand'
import { appVersion } from '../app-version'
import { findMcpServerPids, stopProcesses } from './mcp-server-processes'

/** GH49 — notes de version de la marque : page du tag pour GitHub, page `releasesUrl` telle quelle
 * pour une source `generic` ; absente → pas de lien. */
function releaseUrl(version: string): string | undefined {
  if (!BRAND.releasesUrl) return undefined
  return BRAND.update?.provider === 'github' ? `${BRAND.releasesUrl}/tag/v${version}` : BRAND.releasesUrl
}

/**
 * GH26 — mise à jour automatique (electron-updater, provider GitHub décrit par le `publish`
 * d'electron-builder.yml → app-update.yml packagé). Une seule vérification par session,
 * différée après le démarrage ; téléchargement en arrière-plan ; l'installation se fait à la
 * fermeture de l'app ou via install(). Les erreurs (hors ligne, latest.yml absent…) sont
 * seulement journalisées : le renderer n'affiche que l'état 'ready'.
 */
export class UpdateService {
  private state: UpdateState = { status: 'idle', currentVersion: appVersion() }
  private scheduled = false
  private installRequested = false
  private confirming = false

  constructor(private readonly settings: AppSettingsService) {}

  scheduleStartupCheck(delayMs = 10_000): void {
    if (this.scheduled) return
    // GH49 — marque sans source de mise à jour : aucune vérification (pas d'app-update.yml packagé).
    if (!BRAND.update) return
    // Hors build packagé, electron-updater n'a pas d'app-update.yml : POLENTA_FORCE_DEV_UPDATE=1
    // lui fait lire apps/desktop/dev-app-update.yml pour tester détection + badge en `pnpm dev`.
    // GH49 — dev-app-update.yml décrit la source de Polenta : ignoré pour une autre marque.
    const forceDev = process.env['POLENTA_FORCE_DEV_UPDATE'] === '1' && BRAND.id === 'polenta'
    if (!app.isPackaged && !forceDev) return
    if (!this.settings.get().autoCheckUpdates) return
    this.scheduled = true

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.forceDevUpdateConfig = forceDev
    autoUpdater.logger = {
      info: (m: unknown) => console.log('[update]', m),
      warn: (m: unknown) => console.warn('[update]', m),
      error: (m: unknown) => console.error('[update]', m),
      debug: () => {},
    }

    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => this.setState({ status: 'idle' }))
    autoUpdater.on('update-available', (info) => this.setState({
      status: 'downloading',
      availableVersion: info.version,
      releaseUrl: releaseUrl(info.version),
    }))
    autoUpdater.on('update-downloaded', (info) => this.setState({
      status: 'ready',
      availableVersion: info.version,
      releaseUrl: releaseUrl(info.version),
    }))
    autoUpdater.on('error', (err) => {
      console.error('[update] error:', err?.message ?? err)
      this.setState({ status: 'error' })
    })

    // GH293 — installation à la fermeture : electron-updater lance l'installeur sur 'quit', qui suit
    // 'will-quit'. Plus de fenêtre pour prévenir : les serveurs MCP sont arrêtés directement.
    app.on('will-quit', () => {
      if (this.state.status !== 'ready' || this.installRequested) return
      stopProcesses(this.findMcpServers())
    })

    setTimeout(() => {
      // La promesse rejette aussi hors ligne, en plus de l'événement 'error' déjà traité.
      // GH45 S2b — relu ici : la configuration de la forge (updates: managed) peut être arrivée
      // après le démarrage.
      if (!this.settings.get().autoCheckUpdates) return
      autoUpdater.checkForUpdates().catch(() => {})
    }, delayMs)
  }

  getState(): UpdateState {
    return this.state
  }

  async install(): Promise<void> {
    if (this.state.status !== 'ready' || this.confirming) return
    // GH293 — un serveur MCP lancé depuis l'installation ferait échouer le désinstalleur.
    const mcpServers = this.findMcpServers()
    if (mcpServers.length > 0 && !(await this.confirmStopMcpServers(mcpServers.length))) return
    stopProcesses(mcpServers)
    this.installRequested = true
    // isSilent : pas d'assistant NSIS ; isForceRunAfter : relance l'app après installation.
    autoUpdater.quitAndInstall(true, true)
  }

  private findMcpServers(): number[] {
    return findMcpServerPids(process.execPath, process.resourcesPath)
  }

  private async confirmStopMcpServers(count: number): Promise<boolean> {
    const options = {
      type: 'warning' as const,
      buttons: ['Arrêter et installer', 'Annuler'],
      defaultId: 0,
      cancelId: 1,
      message: count > 1
        ? `${count} serveurs MCP de ${BRAND.productName} seront arrêtés`
        : `Un serveur MCP de ${BRAND.productName} sera arrêté`,
      detail: `Un client MCP (Claude Desktop, Claude Code…) utilise les fichiers de ${BRAND.productName}, ce qui bloquerait la mise à jour. Redémarrez ce client après l'installation pour le reconnecter.`,
    }
    this.confirming = true
    try {
      const win = BrowserWindow.getFocusedWindow()
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
      return response === 0
    } finally {
      this.confirming = false
    }
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    // Plusieurs fenêtres possibles (menu « Ouvrir dans une nouvelle fenêtre »).
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:state-changed', this.state)
    }
  }
}
