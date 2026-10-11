import * as fs from 'fs'
import * as path from 'path'
import type { TeamConfigStatus, TeamProjectEntry } from '@polenta/types'

import type { AuthService } from './auth.service'
import { describeFetchError, isNetworkUnreachable } from './net-proxy'
import { forgeRequest, ForgeHttpError } from './forge/forge-http'
import { parseTeamConfig, resolveTeamConfig } from './forge/team-config'

/**
 * GH45 S2b — configuration Polenta par équipe lue sur la forge du compte courant (spec §3bis) :
 * `<org>/polenta-config/config.yaml`, résolue selon les équipes de l'utilisateur, gardée en cache
 * (`userData/forge-config.json`) pour le hors-ligne. Le renderer déclenche le rafraîchissement
 * (démarrage, connexion, toutes les 30 min) ; `status()` est synchrone, depuis le cache.
 */
export const CONFIG_REPO = 'polenta-config'

interface CacheFile extends TeamConfigStatus {
  /** Compte pour lequel la configuration a été lue (`<hôte>:<login>`). */
  accountKey?: string
}

const EMPTY: CacheFile = { config: null, warnings: [] }

export class ForgeConfigService {
  private cache: CacheFile
  private readonly listeners = new Set<(status: TeamConfigStatus) => void>()

  constructor(private readonly auth: AuthService, private readonly userDataDir: string) {
    this.cache = this.load()
  }

  private get file(): string {
    return path.join(this.userDataDir, 'forge-config.json')
  }

  private load(): CacheFile {
    try {
      return { ...EMPTY, ...(JSON.parse(fs.readFileSync(this.file, 'utf-8')) as CacheFile) }
    } catch {
      return { ...EMPTY }
    }
  }

  private save(next: CacheFile): void {
    this.cache = next
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf-8')
    } catch {
      // cache best-effort : la config en mémoire reste valable pour la session
    }
    const { accountKey: _key, ...status } = next
    for (const l of this.listeners) l(status)
  }

  onChange(listener: (status: TeamConfigStatus) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Configuration actuelle (cache), sans réseau. */
  status(): TeamConfigStatus {
    const { accountKey: _key, ...status } = this.cache
    return status
  }

  /** `managed` dès que la configuration effective le demande (verrou des mises à jour). */
  updatesManaged(): boolean {
    return this.cache.config?.updates === 'managed'
  }

  /** Relit la configuration sur la forge du compte courant. Ne lève jamais : l'erreur va dans le statut. */
  async refresh(): Promise<TeamConfigStatus> {
    const current = await this.auth.currentAccountWithToken()
    if (!current || current.account.provider !== 'forgejo') {
      if (this.cache.config || this.cache.error) this.save({ ...EMPTY })
      return this.status()
    }
    const { account, token } = current
    // Compte ou serveur changé : le cache d'un autre compte ne s'applique jamais.
    const base: CacheFile = this.cache.accountKey === account.key ? this.cache : { ...EMPTY, accountKey: account.key }
    try {
      // Organisation de l'entreprise : la plus ancienne (créée par le kit) qui a une configuration —
      // une organisation créée ensuite par un utilisateur ne peut pas la masquer (le kit interdit
      // d'ailleurs aux utilisateurs d'en créer).
      const orgs: { id: number; username: string }[] = []
      for (let page = 1; page <= 10; page++) {
        const batch = (await forgeRequest<{ id: number; username: string }[]>(`${account.baseUrl}/api/v1/user/orgs?limit=50&page=${page}`, { token })).data
        orgs.push(...batch)
        if (batch.length < 50) break
      }
      orgs.sort((a, b) => a.id - b.id)
      for (const { username: org } of orgs) {
        let text: string
        try {
          const res = await forgeRequest<string>(`${account.baseUrl}/api/v1/repos/${encodeURIComponent(org)}/${CONFIG_REPO}/raw/config.yaml`, { token })
          text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
        } catch (err) {
          if (err instanceof ForgeHttpError && (err.status === 404 || err.status === 403)) continue
          throw err
        }
        const { config, warnings } = parseTeamConfig(text)
        const teams = (await forgeRequest<{ name: string; organization?: { username?: string } }[]>(`${account.baseUrl}/api/v1/user/teams?limit=50`, { token })).data
          .filter(t => (t.organization?.username ?? '').toLowerCase() === org.toLowerCase())
          .map(t => t.name)
        const effective = resolveTeamConfig(config, teams)
        const configured = new Set(config.teams.map(t => t.name.toLowerCase()))
        this.save({
          accountKey: account.key,
          config: { ...effective, teams: teams.filter(t => configured.has(t.toLowerCase())) },
          server: account.baseUrl,
          org,
          fetchedAt: new Date().toISOString(),
          warnings,
        })
        return this.status()
      }
      // Aucune organisation n'a de configuration : comportement par défaut.
      this.save({ accountKey: account.key, config: null, server: account.baseUrl, fetchedAt: new Date().toISOString(), warnings: [] })
    } catch (err) {
      const message = isNetworkUnreachable(err) ? describeFetchError(err) : err instanceof Error ? err.message : String(err)
      this.save({ ...base, accountKey: account.key, error: message })
    }
    return this.status()
  }

  /** Projets proposés à l'utilisateur, limités à ceux auxquels il a accès (spec §3bis-6). */
  async teamProjects(): Promise<TeamProjectEntry[]> {
    const projects = this.cache.config?.projects ?? []
    if (projects.length === 0) return []
    const current = await this.auth.currentAccountWithToken()
    if (!current || current.account.provider !== 'forgejo') return []
    const { account, token } = current
    // En parallèle : l'attente est bornée à un seul délai, quel que soit le nombre de projets.
    const checks = await Promise.allSettled(projects.map(project =>
      forgeRequest<{ clone_url?: string }>(`${account.baseUrl}/api/v1/repos/${project.repo}`, { token, timeoutMs: 10_000 })))
    const out: TeamProjectEntry[] = []
    checks.forEach((check, i) => {
      // inaccessible (droits, supprimé, hors ligne) : non proposé
      if (check.status === 'fulfilled' && check.value.data.clone_url) out.push({ ...projects[i], cloneUrl: check.value.data.clone_url })
    })
    return out
  }
}
