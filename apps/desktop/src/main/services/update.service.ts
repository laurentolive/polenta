import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInstallPlan, UpdateState } from '@polenta/types'
import type { AppSettingsService } from './app-settings.service'
import { BRAND } from '../../shared/brand'
import { appVersion } from '../app-version'
import { findMcpServerPids, stopProcesses } from './mcp-server-processes'

/** GH302 — une app restée ouverte doit voir une release publiée après son démarrage. */
export const PERIODIC_CHECK_MS = 4 * 60 * 60 * 1000
/** GH302 — laisse aux fenêtres le temps d'afficher l'écran d'installation avant la fermeture. */
export const INSTALLING_SCREEN_MS = 1200

/** GH49 — notes de version de la marque : page du tag pour GitHub, page `releasesUrl` telle quelle
 * pour une source `generic` ; absente → pas de lien. */
function releaseUrl(version: string): string | undefined {
  if (!BRAND.releasesUrl) return undefined
  return BRAND.update?.provider === 'github' ? `${BRAND.releasesUrl}/tag/v${version}` : BRAND.releasesUrl
}

/**
 * GH26 — mise à jour automatique (electron-updater, provider décrit par le `publish`
 * d'electron-builder → app-update.yml packagé).
 *
 * GH302 — la vérification se fait toujours (démarrage puis toutes les 4 h), préférence et verrou
 * DSI / forge compris ; la préférence `autoCheckUpdates` ne commande que le téléchargement, le
 * verrou réduit l'état à une information (`managed`). Le renderer affiche chaque état dès la
 * détection ; une vérification qui échoue sans version connue reste silencieuse (journal seul).
 * L'installation est visible : écran 'installing' dans les fenêtres, puis installeur NSIS non
 * silencieux, puis relance.
 */
export class UpdateService {
  private state: UpdateState = { status: 'idle', currentVersion: appVersion() }
  private scheduled = false
  private installRequested = false

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
    this.scheduled = true

    // Le service décide seul du téléchargement (préférence, verrou) : maybeDownload().
    autoUpdater.autoDownload = false
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

    autoUpdater.on('checking-for-update', () => {
      // Une version déjà connue reste affichée pendant une nouvelle vérification.
      if (!this.state.availableVersion) this.setState({ status: 'checking' })
    })
    autoUpdater.on('update-not-available', () => {
      // Release retirée entre deux vérifications : plus rien à proposer. Un téléchargement en
      // cours ou terminé garde son état.
      if (['downloading', 'ready', 'installing'].includes(this.state.status)) return
      this.setState({ status: 'idle', availableVersion: undefined, releaseUrl: undefined, managed: undefined })
    })
    autoUpdater.on('update-available', (info) => {
      // Nouvelle vérification pendant un téléchargement manuel (download()) : l'état reste.
      if (this.state.status === 'downloading') return
      this.setState({
        status: 'available',
        availableVersion: info.version,
        releaseUrl: releaseUrl(info.version),
        managed: this.locked(),
        progress: undefined,
      })
      this.maybeDownload()
    })
    autoUpdater.on('download-progress', (p) => {
      const progress = Math.floor(p.percent)
      if (this.state.status === 'downloading' && this.state.progress === progress) return
      this.setState({ status: 'downloading', progress })
    })
    autoUpdater.on('update-downloaded', (info) => this.setState({
      status: 'ready',
      availableVersion: info.version,
      releaseUrl: releaseUrl(info.version),
      progress: undefined,
    }))
    autoUpdater.on('error', (err) => {
      console.error('[update] error:', err?.message ?? err)
      switch (this.state.status) {
        // Seul un téléchargement interrompu est montré (« Réessayer »).
        case 'downloading':
          this.setState({ status: 'error', progress: undefined })
          break
        // Installeur non lancé : la mise à jour téléchargée reste proposée.
        case 'installing':
          this.installRequested = false
          this.setState({ status: 'ready' })
          break
        // Vérification échouée (hors ligne, réseau qui bloque la source) : silencieuse ; une
        // version déjà connue reste affichée telle quelle.
        case 'checking':
          this.setState({ status: 'idle' })
          break
        default:
          break
      }
    })

    // Préférence cochée alors qu'une version attend : téléchargement immédiat.
    this.settings.onChange(() => {
      this.refreshManaged()
      if (this.state.status === 'available') this.maybeDownload()
    })

    // GH293 — installation à la fermeture : electron-updater lance l'installeur sur 'quit', qui suit
    // 'will-quit'. Plus de fenêtre pour prévenir : les serveurs MCP sont arrêtés directement.
    app.on('will-quit', () => {
      if (this.state.status !== 'ready' || this.installRequested) return
      stopProcesses(this.findMcpServers())
    })

    setTimeout(() => this.check(), delayMs)
    setInterval(() => this.check(), PERIODIC_CHECK_MS).unref?.()
  }

  /** GH342 — appelé juste avant `quitAndInstall` (fenêtres : saisies enregistrées, garde levée). */
  private beforeInstall: () => Promise<void> = async () => {}
  onBeforeInstall(fn: () => Promise<void>): void {
    this.beforeInstall = fn
  }

  getState(): UpdateState {
    return this.state
  }

  /** Téléchargement manuel (préférence décochée) ou nouvel essai après une erreur. */
  async download(): Promise<void> {
    if (!this.scheduled || !this.state.availableVersion) return
    // Verrou arrivé après l'affichage (configuration de la forge chargée plus tard) : l'état est
    // corrigé, le bouton « Télécharger » disparaît.
    if (this.refreshManaged()) return
    if (this.state.status !== 'available' && this.state.status !== 'error') return
    try {
      // downloadUpdate() s'appuie sur la dernière vérification : elle est refaite (erreur réseau,
      // release retirée entre-temps → 'update-not-available' a remis l'état au repos).
      const result = await autoUpdater.checkForUpdates()
      if (!result?.isUpdateAvailable) return
      // La vérification a pu lancer le téléchargement elle-même (préférence cochée).
      if (this.state.status !== 'available' && this.state.status !== 'error') return
      this.setState({ status: 'downloading', progress: 0 })
      await autoUpdater.downloadUpdate()
    } catch (err) {
      // L'événement 'error' a déjà posé l'état.
      console.error('[update] téléchargement :', err instanceof Error ? err.message : err)
    }
  }

  prepareInstall(callerWebContentsId?: number): UpdateInstallPlan {
    return {
      mcpServers: this.state.status === 'ready' ? this.findMcpServers().length : 0,
      // Fenêtres cachées (rendu PDF, instantanés draw.io) : pas des fenêtres de l'utilisateur.
      otherWindows: BrowserWindow.getAllWindows()
        .filter(w => !w.isDestroyed() && w.isVisible() && w.webContents.id !== callerWebContentsId).length,
    }
  }

  /** Appelé après la confirmation du renderer (qui a annoncé fenêtres et serveurs MCP fermés). */
  async install(): Promise<void> {
    if (this.state.status !== 'ready' || this.installRequested) return
    this.installRequested = true
    this.setState({ status: 'installing' })
    await new Promise((resolve) => setTimeout(resolve, INSTALLING_SCREEN_MS))
    // GH293 — un serveur MCP lancé depuis l'installation ferait échouer le désinstalleur.
    stopProcesses(this.findMcpServers())
    // GH342 — fenêtres multiples : saisies enregistrées et garde de fermeture levée avant que
    // `quitAndInstall` ne ferme les fenêtres (sous macOS, avant `before-quit`).
    await this.beforeInstall()
    // isSilent=false : fenêtre de progression de l'installeur NSIS en un clic, sans question ;
    // isForceRunAfter : relance l'app après installation.
    autoUpdater.quitAndInstall(false, true)
  }

  private check(): void {
    if (['downloading', 'ready', 'installing'].includes(this.state.status)) return
    this.refreshManaged()
    // La promesse rejette aussi hors ligne, en plus de l'événement 'error' déjà traité.
    autoUpdater.checkForUpdates()?.catch(() => {})
  }

  private maybeDownload(): void {
    if (this.locked() || !this.settings.get().autoCheckUpdates) return
    this.setState({ status: 'downloading', progress: 0 })
    autoUpdater.downloadUpdate().catch((err: unknown) => {
      console.error('[update] téléchargement :', err instanceof Error ? err.message : err)
    })
  }

  /** GH45 — `autoUpdate: false` (DSI) ou `updates: managed` (forge) : relu à chaque fois, la
   *  configuration de la forge peut arriver après le démarrage. */
  private locked(): boolean {
    return this.settings.get().autoCheckUpdatesLocked === true
  }

  /** Aligne `managed` sur le verrou (diffusé seulement s'il change) ; renvoie le verrou. */
  private refreshManaged(): boolean {
    const locked = this.locked()
    if (this.state.availableVersion && this.state.managed !== locked) this.setState({ managed: locked })
    return locked
  }

  private findMcpServers(): number[] {
    return findMcpServerPids(process.execPath, process.resourcesPath)
  }

  private setState(patch: Partial<UpdateState>): void {
    const next = { ...this.state, ...patch }
    for (const key of Object.keys(next) as (keyof UpdateState)[]) {
      if (next[key] === undefined) delete next[key]
    }
    this.state = next
    // Plusieurs fenêtres possibles (menu « Ouvrir dans une nouvelle fenêtre »).
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:state-changed', this.state)
    }
  }
}
