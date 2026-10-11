import * as fsP from 'fs/promises'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import type { PrintRenderer } from '../../main/host/print-renderer'
import { PRINT_ROUTE_BY_KIND } from '../../main/host/print-renderer'
import { drawioKey, type DrawioSnapshot, type DrawioSnapshotter } from '../../main/services/export/template/drawio-ref'

/**
 * GH44 S4 — rendu des routes `/print/*` du renderer par un Chromium headless (design §6.1), avec
 * le même code React que le desktop (`electron-pdf.ts`, `electron-drawio-snapshot.ts`) : la page
 * est chargée depuis le serveur web lui-même, dans une session d'impression propre à l'utilisateur
 * (ses droits, son espace), détruite après le rendu.
 */

/** Cookies d'une session d'impression, et sa destruction une fois le rendu terminé. */
export interface PrintSession {
  cookies: Array<{ name: string; value: string }>
  dispose(): void
}

const PDF_TIMEOUT_MS = 20_000
const DRAWIO_BASE_TIMEOUT_MS = 30_000
const DRAWIO_PER_ITEM_TIMEOUT_MS = 12_000
/**
 * Diagrammes rendus par chargement de page : leur liste voyage dans l'URL, dont la taille est
 * bornée par le serveur HTTP (en-têtes ≤ 16 Ko) — un gabarit à 100 diagrammes est rendu en lots.
 */
const DRAWIO_BATCH = 20
/** Marge de la session d'impression au-delà du délai maximal du rendu (lancement du navigateur…). */
const SESSION_MARGIN_MS = 60_000
const ZOOM = 2 // netteté des diagrammes, comme le desktop
const VIEWPORT = { width: 1600, height: 1200 }
const MAX_CONCURRENT = 2
const BROWSER_IDLE_MS = 10 * 60_000

interface CssRect { x: number; y: number; width: number; height: number }

export class HeadlessPrinter {
  private browser: Promise<Browser> | null = null
  private running = 0
  private readonly queue: Array<() => void> = []
  private idleTimer: NodeJS.Timeout | null = null

  /** Adresse interne du serveur web (http://127.0.0.1:<port>), lue au moment du rendu. */
  constructor(private readonly baseUrlOf: () => string) {}

  private get baseUrl(): string {
    return this.baseUrlOf()
  }

  /**
   * Imprimante d'un utilisateur : chaque rendu ouvre puis détruit sa session d'impression, valable
   * le temps maximal de ce rendu (`ttlMs`).
   */
  forUser(openSession: (ttlMs: number) => PrintSession): PrintRenderer {
    return {
      renderPdf: (kind, params, destPath) =>
        this.withPage(() => openSession(PDF_TIMEOUT_MS + SESSION_MARGIN_MS), ZOOM_NONE, page => this.pdf(page, kind, params, destPath)),
      snapshotDrawios: (repoPath, refs) => {
        const unique = [...new Map(refs.map(r => [drawioKey(r), r])).values()]
        if (unique.length === 0) return Promise.resolve(new Map<string, DrawioSnapshot>())
        const batches = Math.ceil(unique.length / DRAWIO_BATCH)
        const ttlMs = batches * DRAWIO_BASE_TIMEOUT_MS + unique.length * DRAWIO_PER_ITEM_TIMEOUT_MS + SESSION_MARGIN_MS
        return this.withPage(() => openSession(ttlMs), ZOOM, page => this.drawios(page, repoPath, unique))
      },
    }
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const b = this.browser
    this.browser = null
    if (b) await (await b).close().catch(() => {})
  }

  private launch(): Promise<Browser> {
    this.browser ??= chromium.launch({ headless: true }).catch(err => {
      this.browser = null
      throw new Error(`Impression indisponible : navigateur headless introuvable (${err instanceof Error ? err.message : err}).`)
    })
    return this.browser
  }

  private async acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT) {
      this.running++
      return
    }
    await new Promise<void>(resolve => this.queue.push(resolve))
    this.running++
  }

  private release(): void {
    this.running--
    this.queue.shift()?.()
    if (this.running === 0 && this.queue.length === 0) {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => { void this.close() }, BROWSER_IDLE_MS)
      this.idleTimer.unref()
    }
  }

  private async withPage<T>(openSession: () => PrintSession, scale: number, run: (page: Page) => Promise<T>): Promise<T> {
    await this.acquire()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const session = openSession()
    let context: BrowserContext | null = null
    try {
      const browser = await this.launch()
      context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: scale })
      await context.addCookies(session.cookies.map(c => ({ ...c, url: this.baseUrl })))
      return await run(await context.newPage())
    } finally {
      await context?.close().catch(() => {})
      session.dispose()
      this.release()
    }
  }

  private printUrl(route: string, params: Record<string, string>): string {
    return `${this.baseUrl}/?${new URLSearchParams({ ...params, __print: route })}`
  }

  private async pdf(page: Page, kind: Parameters<PrintRenderer['renderPdf']>[0], params: Record<string, string>, destPath: string): Promise<void> {
    const route = PRINT_ROUTE_BY_KIND[kind]
    if (!route) throw new Error(`Export PDF non implémenté pour "${kind}"`)
    let ready!: () => void
    const readyPromise = new Promise<void>(resolve => { ready = resolve })
    // Appelé par le bridge sur `export:print-ready` (useNotifyPrintReady), comme l'IPC du desktop.
    await page.exposeFunction('__polentaPrintReady', () => { ready() })
    await page.goto(this.printUrl(route, params))
    await withTimeout(readyPromise, PDF_TIMEOUT_MS, 'Délai dépassé au chargement de la page à imprimer')
    await fsP.writeFile(destPath, await page.pdf({ format: 'A4', printBackground: true }))
  }

  /** `unique` : références déjà dédoublonnées (`drawioKey`), non vide. */
  private async drawios(page: Page, repoPath: string, unique: Parameters<DrawioSnapshotter>[1]): Promise<Map<string, DrawioSnapshot>> {
    const result = new Map<string, DrawioSnapshot>()
    // Lot en cours ; `batchNo` écarte une capture tardive d'un lot précédent (expiré).
    let batch: typeof unique = []
    let batchNo = 0
    let done: () => void = () => {}
    // Un appel par diagramme rendu (index dans le lot, rectangle CSS), puis index -1 : fin du lot
    // (cf. route `/print/drawio-snapshot`). Un diagramme en échec est simplement absent du résultat.
    await page.exposeFunction('__polentaDrawioSnapshotReady', async (index: number, rect: CssRect | null) => {
      if (index < 0) return done()
      const current = batchNo
      const ref = batch[index]
      if (!ref || !rect) return
      const png = await page.screenshot({
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        fullPage: true,
        type: 'png',
      }).catch(() => null)
      if (png && current === batchNo) result.set(drawioKey(ref), { png, width: rect.width, height: rect.height })
    })
    for (let i = 0; i < unique.length; i += DRAWIO_BATCH) {
      batch = unique.slice(i, i + DRAWIO_BATCH)
      batchNo++
      const finished = new Promise<void>(resolve => { done = resolve })
      const response = await page.goto(this.printUrl('/print/drawio-snapshot', { repoPath, itemsJson: JSON.stringify(batch) }))
      if (response && !response.ok()) {
        console.warn(`[print] diagrammes : page d'impression en erreur (HTTP ${response.status()}), repli texte.`)
        continue
      }
      // À l'expiration, les diagrammes déjà capturés sont conservés (repli texte pour les suivants).
      await withTimeout(finished, DRAWIO_BASE_TIMEOUT_MS + DRAWIO_PER_ITEM_TIMEOUT_MS * batch.length, '').catch(() => {})
    }
    return result
  }
}

/** Échelle 1 pour le PDF (vectoriel, indépendant de la densité de pixels). */
const ZOOM_NONE = 1

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}
