import type {
  CreateRepoInput, ForgeCollaborator, ForgeIdentity, ForgeInvitation, ForgeKind, ForgeMember, ForgeOwners, ForgeRepo,
  ForgeRepoDetails, ForgeRepoTeam, ForgeTeam, RepoAccessLevel, RepoVisibility,
} from '@polenta/types'

/**
 * GH45 — ce qui est propre à une forge (design §3.2). L'identité pour toutes ; repos, propriétaires,
 * collaborateurs et équipes (GH107, mesurés : specs/GH107-sprint1.md) pour Forgejo/Gitea et GitHub.
 * `generic` (git HTTPS sans API connue) n'a pas de provider.
 */
export interface ForgeProvider {
  readonly kind: ForgeKind
  resolveIdentity(baseUrl: string, token: string): Promise<ForgeIdentity>
  /** Repos accessibles au compte (toutes pages). */
  listRepos?(baseUrl: string, token: string): Promise<ForgeRepo[]>
  /** GH107 — le compte, puis les organisations où il peut (ou peut-être) créer un repo. */
  listOwners?(baseUrl: string, token: string, login: string): Promise<ForgeOwners>
  repoExists?(baseUrl: string, token: string, owner: string, name: string): Promise<boolean>
  /**
   * GH107 — repo vide (`auto_init: false`). Lève `InvalidRepoNameError`, `RepoNameTakenError`,
   * `ScopeMissingError` ou `OwnerCreateForbiddenError`.
   */
  createRepo?(baseUrl: string, token: string, input: CreateRepoInput): Promise<ForgeRepo>
  /** GH107 — `null` : pas d'accès (404). */
  repoDetails?(baseUrl: string, token: string, owner: string, repo: string): Promise<ForgeRepoDetails | null>
  /** GH107 — description, puis visibilité (deux appels). Refus de visibilité : `VisibilityChangeError`. */
  updateRepo?(baseUrl: string, token: string, owner: string, repo: string, patch: { description?: string; visibility?: RepoVisibility }): Promise<void>
  /** GH107 — collaborateurs directs, sans le propriétaire d'un repo personnel. */
  listCollaborators?(baseUrl: string, token: string, owner: string, repo: string): Promise<ForgeCollaborator[]>
  /** GH107 — ajoute ou change le niveau ; `'invited'` : invitation à accepter (GitHub). */
  setCollaborator?(baseUrl: string, token: string, owner: string, repo: string, login: string, level: RepoAccessLevel): Promise<'added' | 'invited'>
  removeCollaborator?(baseUrl: string, token: string, owner: string, repo: string, login: string): Promise<void>
  /** GH107 — `[]` pour un repo personnel. */
  listRepoTeams?(baseUrl: string, token: string, owner: string, repo: string): Promise<ForgeRepoTeam[]>
  listOrgTeams?(baseUrl: string, token: string, org: string): Promise<ForgeTeam[]>
  /** GH107 — `level` ignoré sur Forgejo (porté par l'équipe). */
  setRepoTeam?(baseUrl: string, token: string, owner: string, repo: string, team: string, level?: RepoAccessLevel): Promise<void>
  removeRepoTeam?(baseUrl: string, token: string, owner: string, repo: string, team: string): Promise<void>
  /** GH107 — GitHub seulement. */
  listInvitations?(baseUrl: string, token: string, owner: string, repo: string): Promise<ForgeInvitation[]>
  /** GH108 — le jeton n'a pas le droit de lire les équipes (GitHub, sans `read:org`). */
  teamScopeMissing?(baseUrl: string, token: string): Promise<boolean>
  cancelInvitation?(baseUrl: string, token: string, owner: string, repo: string, id: number): Promise<void>
  /** `null` : pas d'accès (404/403). */
  repoPermissions?(baseUrl: string, token: string, owner: string, repo: string): Promise<{ pull: boolean; push: boolean; admin: boolean } | null>
  /** `null` : `owner` n'est pas une organisation. */
  orgMembers?(baseUrl: string, token: string, owner: string): Promise<ForgeMember[] | null>
  /** GH106 — branche par défaut et droit admin du compte ; `null` : pas d'accès (404/403). */
  repoInfo?(baseUrl: string, token: string, owner: string, repo: string): Promise<{ defaultBranch: string; admin: boolean } | null>
  /** GH106 — la branche doit déjà exister sur le serveur. */
  setDefaultBranch?(baseUrl: string, token: string, owner: string, repo: string, branch: string): Promise<void>
}

/** Nom de repo déjà pris chez ce propriétaire (spec §6.4). */
export class RepoNameTakenError extends Error {
  constructor(readonly fullName: string) {
    super(`Le dépôt « ${fullName} » existe déjà sur le serveur : choisissez un autre nom.`)
    this.name = 'RepoNameTakenError'
  }
}

/** GH107 — nom refusé avant tout appel (GitHub renommerait un nom invalide sans le dire). */
export class InvalidRepoNameError extends Error {
  constructor(readonly repoName: string) {
    super(`Nom « ${repoName} » invalide : lettres, chiffres, « - », « _ » et « . » seulement, sans « . » ni « - » au début.`)
    this.name = 'InvalidRepoNameError'
  }
}

/** GH107 — le jeton n'a pas le scope demandé par la forge (Forgejo `write:user`, GitHub `read:org`). */
export class ScopeMissingError extends Error {
  constructor(readonly host: string, readonly scope: string) {
    super(`Votre connexion à ${host} ne permet pas cette opération (droit « ${scope} » manquant) : reconnectez-vous à ${host} pour l'accorder.`)
    this.name = 'ScopeMissingError'
  }
}

/** GH107 — la forge refuse la création chez ce propriétaire (critère 7 amendé de GH103 §2.4). */
export class OwnerCreateForbiddenError extends Error {
  constructor(readonly owner: string, readonly forgeMessage: string) {
    super(`Votre compte n'a pas le droit de créer un dépôt dans l'organisation « ${owner} ». Demandez ce droit à un administrateur de « ${owner} », ou choisissez un autre propriétaire.`)
    this.name = 'OwnerCreateForbiddenError'
  }
}

/** GH107 — la forge refuse le changement de visibilité. */
export class VisibilityChangeError extends Error {
  constructor(readonly visibility: RepoVisibility, readonly forgeMessage: string, readonly inProgress: boolean) {
    super(inProgress
      ? 'Un changement de visibilité est encore en cours sur le serveur : réessayez dans quelques instants.'
      : `Le serveur refuse de rendre ce dépôt ${visibility === 'public' ? 'public' : 'privé'}${forgeMessage ? ` (${forgeMessage})` : ''}. Un administrateur du serveur peut le faire.`)
    this.name = 'VisibilityChangeError'
  }
}

/** GH108 — écriture refusée côté main : l'interface n'est pas la seule barrière (spec §3.1). */
export class AdminRequiredError extends Error {
  constructor(readonly fullName: string) {
    super(`Réservé aux administrateurs du repo ${fullName}.`)
    this.name = 'AdminRequiredError'
  }
}

/** GH108 — garde du §3.2 de la spec : le repo ne doit pas rester sans administrateur. */
export class LastAdminError extends Error {
  constructor(readonly login: string) {
    super(`${login} est le dernier administrateur direct de ce repo, et aucune équipe admin n'y a accès : ajoutez d'abord un autre administrateur.`)
    this.name = 'LastAdminError'
  }
}

/** GH107 — compte inconnu de la forge. */
export class UnknownAccountError extends Error {
  constructor(readonly login: string) {
    super(`Aucun compte « ${login} » sur le serveur.`)
    this.name = 'UnknownAccountError'
  }
}

/** Nom accepté par Forgejo et par GitHub sans transformation. */
export function assertRepoName(name: string): void {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name.startsWith('.') || name.startsWith('-')) throw new InvalidRepoNameError(name)
}

/** `pull`/`push` (GitHub) ou `read`/`write`/`admin` (Forgejo) → niveau Polenta ; autres tels quels. */
export function normalizeLevel(level: string): RepoAccessLevel | string {
  switch (level) {
    case 'pull': case 'read': return 'read'
    case 'push': case 'write': return 'write'
    case 'admin': return 'admin'
    default: return level
  }
}

/** Hôte d'une URL de base, pour les messages. */
export function hostOf(baseUrl: string): string {
  try { return new URL(baseUrl).host } catch { return baseUrl }
}
