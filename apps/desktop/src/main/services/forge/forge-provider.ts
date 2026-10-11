import type { ForgeIdentity, ForgeKind, ForgeMember, ForgeOrg, ForgeRepo } from '@polenta/types'

/**
 * GH45 — ce qui est propre à une forge (design §3.2). L'identité pour toutes ; les fonctions P1
 * (repos, organisations, membres — sprint 4) pour Forgejo/Gitea seulement. `generic` (git HTTPS
 * sans API connue) n'a pas de provider.
 */
export interface ForgeProvider {
  readonly kind: ForgeKind
  resolveIdentity(baseUrl: string, token: string): Promise<ForgeIdentity>
  /** Repos accessibles au compte (toutes pages). */
  listRepos?(baseUrl: string, token: string): Promise<ForgeRepo[]>
  /** Organisations dans lesquelles le compte peut créer un repo. */
  listCreatableOrgs?(baseUrl: string, token: string, login: string): Promise<ForgeOrg[]>
  repoExists?(baseUrl: string, token: string, owner: string, name: string): Promise<boolean>
  /** Repo privé, vide, branche par défaut `main`. Lève `RepoNameTakenError` si le nom est pris. */
  createOrgRepo?(baseUrl: string, token: string, org: string, name: string): Promise<ForgeRepo>
  /** `null` : pas d'accès (404/403). */
  repoPermissions?(baseUrl: string, token: string, owner: string, repo: string): Promise<{ pull: boolean; push: boolean; admin: boolean } | null>
  /** `null` : `owner` n'est pas une organisation. */
  orgMembers?(baseUrl: string, token: string, owner: string): Promise<ForgeMember[] | null>
}

/** Nom de repo déjà pris dans l'organisation (spec §6.4). */
export class RepoNameTakenError extends Error {
  constructor(readonly fullName: string) {
    super(`Le dépôt « ${fullName} » existe déjà sur le serveur : choisissez un autre nom.`)
    this.name = 'RepoNameTakenError'
  }
}
