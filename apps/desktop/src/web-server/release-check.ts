import type { UpdateState } from '@polenta/types'
import type { BrandUpdate } from '../shared/brand-types'

/** GH302 — même cadence que le desktop (UpdateService). */
export const RELEASE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>

/** X.Y.Z[-pré] → nombres + pré-version ; `v` initial toléré ; null si illisible. */
function parse(version: string): { nums: number[]; pre: string | null } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim())
  if (!m) return null
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }
}

/**
 * `candidate` est-elle plus récente que `current` ? À X.Y.Z égal, une pré-version (build de dev
 * `X.Y.Z-alpha.N`, GH158) est antérieure à la release. Version illisible → false (rien proposé).
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i]! > b.nums[i]!
  }
  if (a.pre === b.pre) return false
  if (a.pre === null) return true
  if (b.pre === null) return false
  return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0
}

/** `version:` de `latest.yml` (electron-builder, source `generic`). */
export function versionFromLatestYml(text: string): string | null {
  const m = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)
  return m ? m[1]! : null
}

/**
 * GH302 W2 — dernière release de la marque, pour informer l'administrateur de l'instance qu'une
 * version plus récente du client web existe. Au démarrage puis toutes les 4 h ; résultat en
 * mémoire ; un échec (hors ligne, réseau filtré) est journalisé et garde le résultat précédent.
 * L'information est publique (page des releases) : le filtrage administrateur se fait à l'affichage.
 */
export class ReleaseCheck {
  private latest: { version: string; releaseUrl?: string } | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly currentVersion: string,
    private readonly source: BrandUpdate | undefined,
    private readonly releasesUrl: string | undefined,
    private readonly log: (msg: string) => void = (msg) => console.warn(msg),
    private readonly fetchImpl: Fetch = globalThis.fetch as unknown as Fetch,
  ) {}

  start(): void {
    if (!this.source || this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), RELEASE_CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  state(): UpdateState {
    if (this.latest && isNewer(this.latest.version, this.currentVersion)) {
      return {
        status: 'available',
        currentVersion: this.currentVersion,
        availableVersion: this.latest.version,
        ...(this.latest.releaseUrl ? { releaseUrl: this.latest.releaseUrl } : {}),
      }
    }
    return { status: 'idle', currentVersion: this.currentVersion }
  }

  async check(): Promise<void> {
    const source = this.source
    if (!source) return
    try {
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      if (source.provider === 'github') {
        const res = await this.fetchImpl(
          `https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`,
          { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'polenta-web' }, signal },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json() as { tag_name?: unknown; html_url?: unknown }
        if (typeof body.tag_name !== 'string') throw new Error('tag_name absent')
        this.latest = {
          version: body.tag_name.replace(/^v/, ''),
          ...(typeof body.html_url === 'string' ? { releaseUrl: body.html_url } : {}),
        }
      } else {
        const res = await this.fetchImpl(`${source.url.replace(/\/+$/, '')}/latest.yml`, { signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const version = versionFromLatestYml(await res.text())
        if (!version) throw new Error('version absente de latest.yml')
        this.latest = { version, ...(this.releasesUrl ? { releaseUrl: this.releasesUrl } : {}) }
      }
    } catch (err) {
      this.log(`[update] vérification de la dernière release impossible : ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
