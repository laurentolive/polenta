import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import type { CreateOnServerResult, ForgeAccount, ForgeMember, ForgeOrg, ForgeRepo, ForgeRepoAccess } from '@polenta/types'

import type { AuthService } from '../auth.service'
import type { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import { RepoNameTakenError } from './forge-provider'
import { forgejoProvider } from './forgejo.provider'
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

  async listRepos(accountKey: string): Promise<ForgeRepo[]> {
    const { account, token } = await this.require(accountKey)
    // Le repo de configuration de l'organisation (GH45 S2b) n'est pas un projet Polenta.
    return (await this.guard(account, () => forgejoProvider.listRepos!(account.baseUrl, token))).filter(r => r.name !== CONFIG_REPO)
  }

  async creatableOrgs(accountKey: string): Promise<ForgeOrg[]> {
    const { account, token } = await this.require(accountKey)
    return this.guard(account, () => forgejoProvider.listCreatableOrgs!(account.baseUrl, token, account.login))
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

  /**
   * Nouveau projet sur le serveur (spec §6.2-6.4, design §4.2) : nom vérifié AVANT toute écriture
   * locale, repo privé créé, projet local créé comme aujourd'hui (GH27), `origin`, publication de
   * `main`. Un échec de la publication n'annule rien : le projet reste ouvert avec `origin` et un
   * avertissement. Le repo distant n'est jamais supprimé.
   */
  async createProjectOnServer(containerDir: string, name: string, accountKey: string, org: string): Promise<CreateOnServerResult> {
    const remote = await this.createRemoteRepo(accountKey, org, name)
    const rootRepoPath = path.join(containerDir, name)
    await this.workspace.createNewProject(containerDir, name)
    await git.addRemote({ fs, dir: rootRepoPath, remote: 'origin', url: remote.cloneUrl, force: true })
    const pushWarning = await this.publishMain(rootRepoPath)
    // Réouvert : l'arbre du workspace connaît maintenant l'URL d'origin.
    return { open: await this.workspace.openWorkspace(containerDir), cloneUrl: remote.cloneUrl, pushWarning }
  }

  /**
   * Nouveau composant sur le serveur (spec §6.5) : repo créé et initialisé avec le même contenu
   * qu'un nouveau projet, préparé dans un dossier temporaire puis publié. Renvoie l'URL, que la
   * fenêtre d'ajout inscrit dans le champ URL : l'ajout et le clone suivent le flux habituel.
   */
  async createComponentOnServer(accountKey: string, org: string, name: string): Promise<{ cloneUrl: string }> {
    const remote = await this.createRemoteRepo(accountKey, org, name)
    const tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'polenta-composant-'))
    try {
      const dir = path.join(tmp, name)
      await this.workspace.initProjectRepo(dir)
      await git.addRemote({ fs, dir, remote: 'origin', url: remote.cloneUrl, force: true })
      const warning = await this.publishMain(dir)
      // Un repo resté vide ne pourrait pas être cloné par l'ajout qui suit.
      if (warning) throw new Error(`Le dépôt ${remote.fullName} a été créé sur le serveur mais n'a pas pu être initialisé (${warning}). Réessayez avec « Saisir une URL » : ${remote.cloneUrl}`)
    } finally {
      await fsPromises.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
    return { cloneUrl: remote.cloneUrl }
  }

  private async createRemoteRepo(accountKey: string, org: string, name: string): Promise<ForgeRepo> {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name.startsWith('.')) {
      throw new Error(`Nom « ${name} » invalide : lettres, chiffres, « - », « _ » et « . » seulement.`)
    }
    const { account, token } = await this.require(accountKey)
    return this.guard(account, async () => {
      if (await forgejoProvider.repoExists!(account.baseUrl, token, org, name)) throw new RepoNameTakenError(`${org}/${name}`)
      return forgejoProvider.createOrgRepo!(account.baseUrl, token, org, name)
    })
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

  /** Publie `main` ; renvoie le message d'erreur à afficher, ou `undefined` si la publication a réussi. */
  private async publishMain(repoPath: string): Promise<string | undefined> {
    try {
      await this.sync.pushBranch(repoPath, 'main')
      return undefined
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  private async require(accountKey: string): Promise<{ account: ForgeAccount; token: string }> {
    const found = await this.auth.accountWithTokenByKey(accountKey)
    if (!found || found.account.provider !== 'forgejo') throw new Error('Compte introuvable ou déconnecté : reconnectez-vous.')
    return found
  }

  private async originTarget(repoPath: string): Promise<{ account: ForgeAccount; token: string; owner: string; repo: string } | null> {
    const url = await originUrl(repoPath)
    const parsed = url ? parseRepoUrl(url) : null
    if (!url || !parsed) return null
    const found = await this.auth.accountWithTokenForUrl(url)
    if (!found || found.account.provider !== 'forgejo') return null
    return { ...found, ...parsed }
  }
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
