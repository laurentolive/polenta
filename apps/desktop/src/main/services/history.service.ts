import {
  applyHistory, effectiveHistory, hasHistoryGap, historyTimestamp,
} from '@polenta/types'
import type {
  HistoryActor, HistoryCarrier, HistoryFallback, ObjectHistory, ObjectTypeDefinition,
} from '@polenta/types'
import type { GitService } from './git.service'
import { readOwnedTypeDef } from './field-write.util'

/** Repli connu sans appel git (exigences / tests : dates du dernier commit fournies par l'index). */
export interface AuditDates {
  updatedAt: string | null
  updatedBy: string | null
}

/**
 * GH77 — historique des champs suivis (specs/GH77-design.md §2). Toute écriture d'exigence, de
 * test ou de campagne passe par `stamp` juste avant `writeYaml`, sous le verrou de l'objet : une
 * entrée par champ suivi qui a changé, sans branchement action par action. L'acteur (`by`,
 * `source`) dépend de l'hôte : compte du projet sur le desktop et le web, `--user` + `mcp` dans le
 * serveur MCP.
 */
export class HistoryService {
  constructor(
    private readonly git: GitService,
    private readonly actor: (repoPath: string) => Promise<HistoryActor>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * `after` complété de ses entrées d'historique. `before` null = création. `audit` : dates du
   * dernier commit si l'appelant les a ; sinon (campagnes) `filePath` permet de les lire dans git,
   * seulement si un trou est à combler. `ownerRepo` : repo du fichier, quand il diffère du repo
   * ouvert (type d'un composant en repo séparé).
   */
  async stamp<T extends HistoryCarrier>(
    repoPath: string,
    objectTypeRef: string | undefined,
    before: HistoryCarrier | null,
    after: T,
    audit: AuditDates | { filePath: string },
    ownerRepo?: string,
    /** GH163 — commentaire de modification, posé sur les entrées créées par cette écriture. */
    comment?: string,
  ): Promise<T> {
    const typeDef = await this.typeDef(repoPath, objectTypeRef, ownerRepo)
    const now = this.now()
    // Acteur résolu seulement si une entrée est ajoutée : une sauvegarde automatique sans
    // changement suivi (cas courant) ne paie ni lecture du compte ni lecture git.
    const fallback = before && hasHistoryGap(before, typeDef) ? await this.fallback(ownerRepo ?? repoPath, audit) : { at: null, by: null }
    if (applyHistory(before, after, typeDef, { by: '' }, now, fallback) === after) return after
    const actor = await this.actor(repoPath).catch((): HistoryActor => ({ by: 'local' }))
    return applyHistory(before, after, typeDef, { ...actor, ...(comment && { comment }) }, now, fallback)
  }

  /** Lecture effective (spec §7) : historique + entrées implicites, rien n'est écrit. */
  async effective(
    repoPath: string, obj: HistoryCarrier & { objectTypeRef?: string }, audit: AuditDates | { filePath: string },
  ): Promise<ObjectHistory> {
    const typeDef = await this.typeDef(repoPath, obj.objectTypeRef)
    const fallback = hasHistoryGap(obj, typeDef) ? await this.fallback(repoPath, audit) : { at: null, by: null }
    return effectiveHistory(obj, typeDef, fallback, this.now())
  }

  /**
   * Type de l'objet : dans le schéma du repo ouvert, sinon (nœud submodule sans `objectTypes`) dans
   * celui du repo propriétaire, par nom de type. Lu sur disque à chaque écriture, comme
   * `readTypeDef` des services : un processus long (serveur MCP) voit le schéma enregistré par
   * l'application. Introuvable : null, seul le statut est alors suivi.
   */
  private typeDef(repoPath: string, objectTypeRef: string | undefined, ownerRepo?: string): Promise<ObjectTypeDefinition | null> {
    return readOwnedTypeDef(this.git, repoPath, objectTypeRef, ownerRepo)
  }

  private async fallback(repoPath: string, audit: AuditDates | { filePath: string }): Promise<HistoryFallback> {
    const dates = 'filePath' in audit
      ? await this.git.fileHistory(repoPath, audit.filePath).catch(() => null)
      : audit
    const at = dates?.updatedAt ? historyTimestamp(new Date(dates.updatedAt)) : null
    return { at, by: dates?.updatedBy ?? null }
  }
}

export type HistoryObjectKind = 'requirement' | 'test' | 'campaign' | 'changeset'

/** Services de lecture des objets, pour `readEffectiveHistory` (évite une dépendance circulaire). */
export interface HistoryObjectReaders {
  history: HistoryService
  requirements: { findOne(repoPath: string, id: string): Promise<HistoryCarrier & { objectTypeRef: string } & AuditDates> }
  tests: { findOne(repoPath: string, id: string): Promise<HistoryCarrier & { objectTypeRef: string } & AuditDates> }
  campaigns: { get(repoPath: string, id: string): Promise<HistoryCarrier & { objectTypeRef?: string }> }
  /** GH198 — changes (`repoPath` = repo de stockage du change). */
  changes?: { get(repoPath: string, id: string): Promise<HistoryCarrier & { objectTypeRef: string }> }
}

/** GH77 — historique effectif d'un objet (IPC `history:get`, tools de lecture MCP). */
export async function readEffectiveHistory(
  c: HistoryObjectReaders, repoPath: string, kind: HistoryObjectKind, id: string,
): Promise<ObjectHistory> {
  if (kind === 'requirement') {
    const req = await c.requirements.findOne(repoPath, id)
    return c.history.effective(repoPath, req, req)
  }
  if (kind === 'test') {
    const test = await c.tests.findOne(repoPath, id)
    return c.history.effective(repoPath, test, test)
  }
  if (kind === 'campaign') {
    const campaign = await c.campaigns.get(repoPath, id)
    return c.history.effective(repoPath, campaign, { filePath: `campaigns/${id}.yaml` })
  }
  if (kind === 'changeset' && c.changes) {
    const change = await c.changes.get(repoPath, id)
    return c.history.effective(repoPath, change, { filePath: `changesets/${id}.yaml` })
  }
  throw new Error(`history:get — unknown object kind: ${String(kind)}`)
}
