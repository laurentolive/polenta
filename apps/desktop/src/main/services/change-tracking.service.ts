import type { ChangeElementRef, ModificationCheck, ModificationKind, ProjectSchema } from '@polenta/types'
import { flattenSystemNodes } from '@polenta/types'
import type { ChangesService } from './changes.service'
import type { GitService } from './git.service'
import type { SchemaService } from './schema.service'

/** Élément qui devient modifiable, tel que vu par les services d'écriture. */
export interface TrackedElement {
  id: string
  /** Chemin du fichier de l'élément dans son repo (`requirements/<ID>.yaml`). */
  filePath: string
  /** `version` de l'élément avant la réouverture (absent : création). */
  versionBefore?: number
}

/**
 * GH200 — crochet appelé par `RequirementsService` / `TestsService` (injection optionnelle, comme
 * la revalidation T172 : pas de dépendance circulaire avec `ChangesService`).
 */
export interface ModificationTracker {
  /** Changeset demandé : ouvert dans le repo de l'élément, sinon erreur — avant toute écriture. */
  assertChangeset(repo: string, changesetId: string): Promise<void>
  /** Assigne l'élément après son écriture ; renvoie l'ID du changeset, `null` si non assigné. */
  onModified(repo: string, el: TrackedElement, kind: ModificationKind, changesetId?: string): Promise<string | null>
}

/**
 * GH200 — rattachement par élément (specs/GH200.md) : toute création, réouverture ou passage
 * terminal depuis l'approuvé d'une exigence ou d'un test l'ajoute à `toModify` d'un changeset
 * ouvert de son repo — celui demandé, sinon le seul ouvert ; plusieurs sans choix : non assigné
 * (backlog). Un élément déjà dans un changeset non clos y reste (P4). Règle par repo :
 * `preferences.changeTracking`, défaut `on` si le repo déclare un type de changeset.
 */
export class ChangeTrackingService implements ModificationTracker {
  constructor(
    private readonly git: GitService,
    private readonly schema: Pick<SchemaService, 'get' | 'resolveComponentRepoPath'>,
    private readonly changes: Pick<ChangesService, 'repoSummaries' | 'attach' | 'componentOf'>,
  ) {}

  async isOn(repo: string): Promise<boolean> {
    return trackingOn(await this.schema.get(repo).catch(() => null))
  }

  /** Contrôle avant une création / réouverture, pour la porte du renderer. */
  async check(
    repoPath: string, el: { id?: string; objectTypeRef: string }, _kind: ModificationKind, workspaceDir?: string,
  ): Promise<ModificationCheck> {
    const repo = (await this.schema.resolveComponentRepoPath(repoPath, el.objectTypeRef, workspaceDir)) ?? repoPath
    const [tracking, summaries, component] = await Promise.all([
      this.isOn(repo),
      this.changes.repoSummaries(repo),
      this.changes.componentOf(repo, el.objectTypeRef),
    ])
    const eligible = summaries.filter(s => s.open)
    const assignedTo = el.id ? eligible.find(s => s.toModifyIds.includes(el.id!))?.id ?? null : null
    return { tracking, assignedTo, eligible, component, repoPath: repo }
  }

  async assertChangeset(repo: string, changesetId: string): Promise<void> {
    const summary = (await this.changes.repoSummaries(repo)).find(s => s.id === changesetId)
    if (!summary) throw new Error(`Changeset introuvable dans le repo de l'élément : ${changesetId}`)
    if (!summary.open) throw new Error(`${changesetId} est clos : il ne reçoit plus d'éléments`)
  }

  async onModified(repo: string, el: TrackedElement, kind: ModificationKind, changesetId?: string): Promise<string | null> {
    if (!(await this.isOn(repo))) return null
    const open = (await this.changes.repoSummaries(repo)).filter(s => s.open)
    const base = kind === 'create' ? undefined : await this.baseOf(repo, el)
    const holder = open.find(s => s.toModifyIds.includes(el.id))
    const target = holder?.id
      ?? (changesetId && open.some(s => s.id === changesetId) ? changesetId : undefined)
      ?? (!changesetId && open.length === 1 ? open[0].id : undefined)
    if (!target) return null
    // Déjà présent (P4) : `attach` ne fait que compléter `base` si elle manque.
    if (!holder || base) await this.changes.attach(repo, target, [{ id: el.id, ...(base && { base }) }])
    return target
  }

  /** Version de départ : dernier commit qui touche le fichier (état approuvé publié). */
  private async baseOf(repo: string, el: TrackedElement): Promise<ChangeElementRef> {
    const [last] = await this.git.fileCommits(repo, el.filePath).catch(() => [])
    return { sha: last?.oid ?? null, version: el.versionBefore ?? 1 }
  }
}

/** Règle active : préférence explicite, sinon présence d'un type de catégorie changeset. */
export function trackingOn(schema: ProjectSchema | null): boolean {
  if (!schema) return false
  const hasType = flattenSystemNodes(schema.nodes ?? [])
    .some(({ node }) => (node.objectTypes ?? []).some(t => t.category === 'changeset'))
  if (!hasType) return false
  return schema.preferences?.changeTracking !== 'off'
}
