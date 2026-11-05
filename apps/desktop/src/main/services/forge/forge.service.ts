import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import type {
  CreateRepoInput, DefaultBranchOutcome, ForgeAccount, ForgeKind, ForgeMember, ForgeOwners, ForgeRepo,
  ForgeRepoAccess, ForgeRepoDetails, ForgeTeam, RepoAccessLevel, RepoMemberGrant, RepoSettings, RepoVisibility,
} from '@polenta/types'

import type { AuthService } from '../auth.service'
import type { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import { AdminRequiredError, assertRepoName, LastAdminError, RepoNameTakenError, type ForgeProvider } from './forge-provider'
import { forgejoProvider } from './forgejo.provider'
import { githubProvider } from './github.provider'
import { ForgeHttpError } from './forge-http'
import { revokedError } from './forge-access'
import { describeFetchError, isNetworkUnreachable } from '../net-proxy'
import { CONFIG_REPO } from '../forge-config.service'

/**
 * GH45 S4 — fonctions P1 sur les forges Forgejo/Gitea (design §4.1) : liste des repos, organisations
 * où créer, droits du compte sur un repo, membres d'une organisation. Les fonctions liées à un repo
 * local renvoient `null` sans erreur quand elles sont sans objet (hors ligne, remote non Forgejo,
 * aucun compte) : ce sont des aides, jamais des blocages (spec §7.3, §8.4).
 */
export class ForgeService {
  /** Membres par `(hôte, organisation)` pour la durée du processus (spec §7.1). */
  private readonly membersCache = new Map<string, Promise<ForgeMember[] | null>>()

  constructor(
    private readonly auth: AuthService,
    private readonly workspace: WorkspaceService,
    private readonly sync: SyncService,
  ) {}

  accounts(): Promise<ForgeAccount[]> {
    return this.auth.forgeAccounts()
  }

  /** GH107 — comptes GitHub et Forgejo connectés, où créer ou adopter un repo. */
  repoAccounts(): Promise<ForgeAccount[]> {
    return this.auth.repoAccounts()
  }

  async listRepos(accountKey: string): Promise<ForgeRepo[]> {
    const { account, token, provider } = await this.require(accountKey)
    // Le repo de configuration de l'organisation (GH45 S2b) n'est pas un projet Polenta.
    return (await this.guard(account, () => provider.listRepos!(account.baseUrl, token))).filter(r => r.name !== CONFIG_REPO)
  }

  /** GH107 — le compte, puis les organisations où créer un repo. */
  async owners(accountKey: string): Promise<ForgeOwners> {
    const { account, token, provider } = await this.require(accountKey)
    return this.guard(account, () => provider.listOwners!(account.baseUrl, token, account.login))
  }

  /** GH107 — nom libre chez ce propriétaire (vérifié pendant la saisie, et avant la création). */
  async nameAvailable(accountKey: string, owner: string, name: string): Promise<boolean> {
    assertRepoName(name)
    const { account, token, provider } = await this.require(accountKey)
    return !(await this.guard(account, () => provider.repoExists!(account.baseUrl, token, owner, name)))
  }

  /** GH107 — équipes d'une organisation (widget Membres). */
  async orgTeams(accountKey: string, org: string): Promise<ForgeTeam[]> {
    const { account, token, provider } = await this.require(accountKey)
    return this.guard(account, () => provider.listOrgTeams!(account.baseUrl, token, org))
  }

  /** GH107 — repo distant vide ; nom vérifié une dernière fois juste avant. */
  async createRemote(accountKey: string, input: CreateRepoInput): Promise<ForgeRepo> {
    assertRepoName(input.name)
    const { account, token, provider } = await this.require(accountKey)
    return this.guard(account, async () => {
      if (await provider.repoExists!(account.baseUrl, token, input.owner, input.name)) throw new RepoNameTakenError(`${input.owner}/${input.name}`)
      return provider.createRepo!(account.baseUrl, token, input)
    })
  }

  /** GH107 — détails d'un repo ; `null` : introuvable ou sans accès. */
  async repoDetails(accountKey: string, owner: string, repo: string): Promise<ForgeRepoDetails | null> {
    const { account, token, provider } = await this.require(accountKey)
    return this.guard(account, () => provider.repoDetails!(account.baseUrl, token, owner, repo))
  }

  /** GH107 — description, puis visibilité. */
  async updateRepo(accountKey: string, owner: string, repo: string, patch: { description?: string; visibility?: RepoVisibility }): Promise<void> {
    const { account, token, provider } = await this.require(accountKey)
    await this.guard(account, () => provider.updateRepo!(account.baseUrl, token, owner, repo, patch))
  }

  /** GH107 — accès d'un compte ou d'une équipe ; `'invited'` : invitation à accepter (GitHub). */
  async grantMember(accountKey: string, owner: string, repo: string, grant: RepoMemberGrant): Promise<'added' | 'invited'> {
    const { account, token, provider } = await this.require(accountKey)
    return this.guard(account, async () => {
      if (grant.kind === 'team') {
        await provider.setRepoTeam!(account.baseUrl, token, owner, repo, grant.name, grant.level)
        return 'added'
      }
      return provider.setCollaborator!(account.baseUrl, token, owner, repo, grant.name, grant.level)
    })
  }

  /** Droits du compte sur le repo `origin` de `repoPath` ; `null` dans les cas sans objet. */
  async repoAccess(repoPath: string): Promise<ForgeRepoAccess | null> {
    const target = await this.originTarget(repoPath)
    if (!target) return null
    try {
      const perms = await forgejoProvider.repoPermissions!(target.account.baseUrl, target.token, target.owner, target.repo)
      // Pas d'accès du tout : signalé par le message GH30 au chargement de l'arbre, pas ici.
      if (!perms) return null
      return { host: target.account.host, repo: `${target.owner}/${target.repo}`, pull: perms.pull, push: perms.push }
    } catch {
      return null   // hors ligne, forge injoignable : aucun diagnostic (spec §8.4)
    }
  }

  /** Membres de l'organisation propriétaire du repo `origin` de `repoPath` ; `null` sans objet. */
  async orgMembers(repoPath: string): Promise<ForgeMember[] | null> {
    const target = await this.originTarget(repoPath)
    if (!target) return null
    const key = `${target.account.host}\n${target.owner.toLowerCase()}`
    let pending = this.membersCache.get(key)
    if (!pending) {
      pending = forgejoProvider.orgMembers!(target.account.baseUrl, target.token, target.owner)
      this.membersCache.set(key, pending)
      // Échec (hors ligne…) : pas mis en cache, on réessaiera au prochain affichage.
      pending.catch(() => { this.membersCache.delete(key) })
    }
    try {
      return await pending
    } catch {
      return null
    }
  }

  /** GH108 — sans appel réseau : `origin` sur une forge `github` ou `forgejo` d'un compte connecté. */
  async repoSettingsAvailable(repoPath: string): Promise<boolean> {
    return (await this.originTarget(repoPath, REPO_KINDS)) !== null
  }

  /**
   * GH108 — contenu de la fenêtre « Paramètres du repo » ; `null` : sans objet. Une forge injoignable
   * rend `offline` ; une liste que la forge refuse à ce compte (lecteur) reste vide, sans erreur.
   */
  async repoSettings(repoPath: string): Promise<RepoSettings | null> {
    const target = await this.originTarget(repoPath, REPO_KINDS)
    const provider = target ? providerFor(target.account.provider) : null
    if (!target || !provider) return null
    const { account, token, owner, repo } = target
    const { baseUrl } = account
    let restricted = false
    const soft = async <T>(op: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await op()
      } catch (err) {
        if (!(err instanceof ForgeHttpError) || (err.status !== 403 && err.status !== 404)) throw err
        restricted = true
        return fallback
      }
    }
    // Dans `guard`, qui traduirait l'erreur réseau en simple message.
    return this.guard(account, async (): Promise<RepoSettings> => {
      try {
        const details = await provider.repoDetails!(baseUrl, token, owner, repo)
        if (!details) throw new Error(`Dépôt ${owner}/${repo} introuvable sur ${account.host} (ou inaccessible avec ce compte).`)
        const orgMembers = await provider.orgMembers!(baseUrl, token, owner).catch(err => {
          if (err instanceof ForgeHttpError && err.status === 403) return null
          throw err
        })
        const isOrg = orgMembers !== null
        const [collaborators, teams, invitations, orgTeams, scopeMissing] = await Promise.all([
          soft(() => provider.listCollaborators!(baseUrl, token, owner, repo), []),
          isOrg ? soft(() => provider.listRepoTeams!(baseUrl, token, owner, repo), []) : Promise.resolve([]),
          details.permissions.admin && provider.listInvitations ? soft(() => provider.listInvitations!(baseUrl, token, owner, repo), []) : Promise.resolve([]),
          isOrg ? soft(() => provider.listOrgTeams!(baseUrl, token, owner), []) : Promise.resolve([]),
          provider.teamScopeMissing?.(baseUrl, token) ?? Promise.resolve(false),
        ])
        return {
          available: true, fullName: `${owner}/${repo}`, host: account.host, login: account.login, details, collaborators, teams,
          invitations, orgTeams, orgMembers: orgMembers ?? [], isOrg, scopeMissing, membersRestricted: restricted,
          teamsUrl: provider.kind === 'github' ? `${baseUrl}/orgs/${owner}/teams` : `${baseUrl}/org/${owner}/teams`,
          teamLevelEditable: provider.kind === 'github',
        }
      } catch (err) {
        if (isNetworkUnreachable(err)) return { available: false, reason: 'offline' }
        throw err
      }
    })
  }

  async updateRepoSettings(repoPath: string, patch: { description?: string; visibility?: RepoVisibility }): Promise<void> {
    if (patch.description !== undefined && !patch.description.trim()) throw new Error('La description est obligatoire.')
    await this.asAdmin(repoPath, (t, p) => p.updateRepo!(t.account.baseUrl, t.token, t.owner, t.repo, {
      ...patch, ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    }))
  }

  /** Ajoute ou change un collaborateur ; rétrograder le dernier admin direct est refusé comme son retrait. */
  async setRepoCollaborator(repoPath: string, login: string, level: RepoAccessLevel): Promise<'added' | 'invited'> {
    return this.asAdmin(repoPath, async (t, p) => {
      if (level !== 'admin') await this.assertNotLastAdmin(t, p, login)
      return p.setCollaborator!(t.account.baseUrl, t.token, t.owner, t.repo, login, level)
    })
  }

  async removeRepoCollaborator(repoPath: string, login: string): Promise<void> {
    await this.asAdmin(repoPath, async (t, p) => {
      await this.assertNotLastAdmin(t, p, login)
      await p.removeCollaborator!(t.account.baseUrl, t.token, t.owner, t.repo, login)
    })
  }

  async setRepoTeamAccess(repoPath: string, team: string, level?: RepoAccessLevel): Promise<void> {
    await this.asAdmin(repoPath, (t, p) => p.setRepoTeam!(t.account.baseUrl, t.token, t.owner, t.repo, team, level))
  }

  async removeRepoTeamAccess(repoPath: string, team: string): Promise<void> {
    await this.asAdmin(repoPath, (t, p) => p.removeRepoTeam!(t.account.baseUrl, t.token, t.owner, t.repo, team))
  }

  async cancelRepoInvitation(repoPath: string, id: number): Promise<void> {
    await this.asAdmin(repoPath, (t, p) => p.cancelInvitation!(t.account.baseUrl, t.token, t.owner, t.repo, id))
  }

  /** Droit admin revérifié ici avant chaque écriture (spec §3.1). */
  private async asAdmin<T>(repoPath: string, op: (target: OriginTarget, provider: ForgeProvider) => Promise<T>): Promise<T> {
    const target = await this.originTarget(repoPath, REPO_KINDS)
    const provider = target ? providerFor(target.account.provider) : null
    if (!target || !provider) throw new Error('Compte introuvable ou déconnecté : reconnectez-vous.')
    return this.guard(target.account, async () => {
      const details = await provider.repoDetails!(target.account.baseUrl, target.token, target.owner, target.repo)
      if (!details?.permissions.admin) throw new AdminRequiredError(`${target.owner}/${target.repo}`)
      return op(target, provider)
    })
  }

  /** Garde du §3.2 : dernier admin direct d'un repo d'organisation, sans équipe admin. */
  private async assertNotLastAdmin(t: OriginTarget, provider: ForgeProvider, login: string): Promise<void> {
    const { baseUrl } = t.account
    // Repo personnel : le propriétaire, exclu de la liste, reste administrateur.
    if (await provider.orgMembers!(baseUrl, t.token, t.owner) === null) return
    const collaborators = await provider.listCollaborators!(baseUrl, t.token, t.owner, t.repo)
    const admins = collaborators.filter(c => c.level === 'admin')
    if (admins.length !== 1 || admins[0].login.toLowerCase() !== login.toLowerCase()) return
    const teams = await provider.listRepoTeams!(baseUrl, t.token, t.owner, t.repo)
    if (!teams.some(team => team.level === 'admin' || team.level === 'owner')) throw new LastAdminError(login)
  }

  /**
   * Erreurs des API de la forge comme pour git (design §3.4) : jeton refusé ou compte désactivé →
   * hôte marqué « accès révoqué » et erreur qui déclenche la bannière de reconnexion ; réseau →
   * message lisible ; autre réponse → statut et message de la forge, sans URL technique.
   */
  private async guard<T>(account: ForgeAccount, op: () => Promise<T>): Promise<T> {
    try {
      return await op()
    } catch (err) {
      if (err instanceof ForgeHttpError) {
        if (err.status === 401 || (err.status === 403 && /prohibited|not allowed/i.test(err.forgeMessage))) {
          this.auth.markAccessRevoked(account.host)
          throw revokedError(account.host, account.baseUrl)
        }
        throw new Error(`Le serveur ${account.host} a refusé l'opération (HTTP ${err.status}${err.forgeMessage ? ` : ${err.forgeMessage}` : ''}).`)
      }
      if (isNetworkUnreachable(err)) throw new Error(describeFetchError(err))
      throw err
    }
  }

  /** GH107 — compte d'une forge ayant un provider (Forgejo ou GitHub), avec ce provider. */
  private async require(accountKey: string): Promise<{ account: ForgeAccount; token: string; provider: ForgeProvider }> {
    const found = await this.auth.accountWithTokenByKey(accountKey)
    const provider = found ? providerFor(found.account.provider) : null
    if (!found || !provider) throw new Error('Compte introuvable ou déconnecté : reconnectez-vous.')
    return { ...found, provider }
  }

  /**
   * GH106 — aligne la branche par défaut du repo `origin` sur la branche d'intégration (spec GH103
   * décision 4). Jamais d'exception : c'est une aide, la désignation ne dépend pas de son succès.
   */
  async alignDefaultBranch(repoPath: string, branch: string): Promise<DefaultBranchOutcome> {
    const target = await this.originTarget(repoPath, ['forgejo', 'github'])
    const provider = target ? providerFor(target.account.provider) : null
    if (!target || !provider?.repoInfo || !provider.setDefaultBranch) return 'no-forge'
    const { account, token, owner, repo } = target
    try {
      return await this.guard(account, async (): Promise<DefaultBranchOutcome> => {
        const info = await provider.repoInfo!(account.baseUrl, token, owner, repo)
        if (!info) return { error: `Dépôt ${owner}/${repo} introuvable sur ${account.host} (ou inaccessible avec ce compte).` }
        if (info.defaultBranch === branch) return 'unchanged'
        if (!info.admin) return 'not-admin'
        await provider.setDefaultBranch!(account.baseUrl, token, owner, repo, branch)
        return 'set'
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async originTarget(repoPath: string, kinds: ForgeKind[] = ['forgejo']): Promise<OriginTarget | null> {
    const url = await originUrl(repoPath)
    const parsed = url ? parseRepoUrl(url) : null
    if (!url || !parsed) return null
    const found = await this.auth.accountWithTokenForUrl(url)
    if (!found || !kinds.includes(found.account.provider)) return null
    return { ...found, ...parsed }
  }
}

/** GH108 — forges où régler un repo depuis Polenta. */
const REPO_KINDS: ForgeKind[] = ['forgejo', 'github']

interface OriginTarget {
  account: ForgeAccount
  token: string
  owner: string
  repo: string
}

function providerFor(kind: ForgeKind): ForgeProvider | null {
  return kind === 'forgejo' ? forgejoProvider : kind === 'github' ? githubProvider : null
}

async function originUrl(repoPath: string): Promise<string | null> {
  try {
    const remotes = await git.listRemotes({ fs, dir: repoPath })
    return remotes.find(r => r.remote === 'origin')?.url ?? null
  } catch {
    return null
  }
}

/** `https://hôte[/sous-chemin]/propriétaire/repo(.git)` → propriétaire et repo ; `null` sinon (SSH…). */
export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const parts = u.pathname.replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean)
  if (parts.length < 2) return null
  return { owner: decodeURIComponent(parts[parts.length - 2]), repo: decodeURIComponent(parts[parts.length - 1]) }
}
