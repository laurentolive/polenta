import {
  applyChangesHistory, applyHistory, changesHistoryDue, effectiveHistory, hasHistoryGap, historyTimestamp,
} from '@polenta/types'
import type {
  HistoryActor, HistoryCarrier, HistoryFallback, ObjectHistory, ObjectTypeDefinition,
} from '@polenta/types'
import type { GitService } from './git.service'
import { readOwnedTypeDef } from './field-write.util'
import { applyAudit, contentChanged, type AuditFields } from './audit-fields.util'

/** Repli d'un trou d'historique fourni par l'appelant (dates d'un commit). */
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

  /** GH204 — identité courante (décisions d'une validation), comme l'historique. */
  currentActor(repoPath: string): Promise<HistoryActor> {
    return this.actor(repoPath).catch((): HistoryActor => ({ by: 'local' }))
  }

  /**
   * GH340 — écriture d'une exigence, d'un test ou d'une issue : entrées d'historique (`stamp`) et
   * dates de création / modification, avec **une seule** horloge et **un seul** acteur — l'entrée
   * d'historique et `updatedAt` d'une même sauvegarde portent le même instant et le même auteur.
   * L'acteur n'est résolu que si l'écriture change quelque chose. `filePath` (relatif au repo du
   * fichier) : repli d'un trou d'historique, le dernier commit du fichier, lu seulement s'il y a un
   * trou — une édition hors de l'application n'avance pas `updatedAt`, qui ne peut donc pas servir.
   */
  async stampObject<T extends HistoryCarrier>(
    repoPath: string,
    objectTypeRef: string | undefined,
    before: HistoryCarrier | null,
    after: T,
    filePath: string,
    ownerRepo?: string,
    comment?: string,
  ): Promise<T & AuditFields> {
    const typeDef = await this.typeDef(repoPath, objectTypeRef, ownerRepo)
    const now = this.now()
    const fallback = before && hasHistoryGap(before, typeDef) ? await this.fallback(ownerRepo ?? repoPath, { filePath }) : { at: null, by: null }
    const historyDue = applyHistory(before, after, typeDef, { by: '' }, now, fallback) !== after
    const changed = !before || contentChanged(before, after)
    if (!historyDue && !changed) return applyAudit(before, after, '', '', false)
    const actor = await this.currentActor(repoPath)
    const stamped = historyDue ? applyHistory(before, after, typeDef, { ...actor, ...(comment && { comment }) }, now, fallback) : after
    return applyAudit(before, stamped, actor.by, historyTimestamp(now), changed)
  }

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

  /**
   * GH202 — liste des changements d'une version : `changes` n'est pas un champ de `fields`, son suivi
   * est toujours actif et passe par sa propre clé d'historique.
   */
  async stampVersionChanges<T extends Parameters<typeof changesHistoryDue>[0]>(repoPath: string, version: T): Promise<T> {
    if (!changesHistoryDue(version)) return version
    const actor = await this.actor(repoPath).catch((): HistoryActor => ({ by: 'local' }))
    return applyChangesHistory(version, actor, this.now())
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

export type HistoryObjectKind = 'requirement' | 'test' | 'campaign' | 'issue'

/** Services de lecture des objets, pour `readEffectiveHistory` (évite une dépendance circulaire). */
export interface HistoryObjectReaders {
  history: HistoryService
  requirements: { findOne(repoPath: string, id: string): Promise<HistoryCarrier & { objectTypeRef: string } & AuditDates> }
  tests: { findOne(repoPath: string, id: string): Promise<HistoryCarrier & { objectTypeRef: string } & AuditDates> }
  campaigns: { get(repoPath: string, id: string): Promise<HistoryCarrier & { objectTypeRef?: string }> }
  /** GH244 — absent : pas d'historique d'issue (`unknown object kind`). */
  issues?: { findOne(repoPath: string, id: string): Promise<HistoryCarrier & { objectTypeRef: string } & AuditDates> }
}

/** GH77 — historique effectif d'un objet (IPC `history:get`, tools de lecture MCP). */
export async function readEffectiveHistory(
  c: HistoryObjectReaders, repoPath: string, kind: HistoryObjectKind, id: string,
): Promise<ObjectHistory> {
  // GH340 — repli d'un trou : dernier commit du fichier (lu seulement s'il y a un trou), pas
  // `updatedAt`, qu'une édition hors de l'application n'avance pas.
  if (kind === 'requirement') {
    const req = await c.requirements.findOne(repoPath, id)
    return c.history.effective(repoPath, req, { filePath: `requirements/${id}.yaml` })
  }
  if (kind === 'test') {
    const test = await c.tests.findOne(repoPath, id)
    return c.history.effective(repoPath, test, { filePath: `tests/${id}.yaml` })
  }
  if (kind === 'campaign') {
    const campaign = await c.campaigns.get(repoPath, id)
    return c.history.effective(repoPath, campaign, { filePath: `campaigns/${id}.yaml` })
  }
  if (kind === 'issue' && c.issues) {
    const issue = await c.issues.findOne(repoPath, id)
    return c.history.effective(repoPath, issue, { filePath: `issues/${id}.yaml` })
  }
  throw new Error(`history:get — unknown object kind: ${String(kind)}`)
}
