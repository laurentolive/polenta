import { evaluateTransition, needsCoverage } from '@polenta/types'
import type { ObjectTypeDefinition, TransitionCheck, TransitionIssue } from '@polenta/types'
import type { TraceabilityService } from './traceability.service'

/** GH206 — passage de statut refusé : le message commence par le code et cite tous les motifs. */
export class TransitionBlockedError extends Error {
  constructor(readonly issues: TransitionIssue[]) {
    super(`TRANSITION_BLOCKED: ${issues.map(i => i.message).join(' ; ')}`)
    this.name = 'TransitionBlockedError'
  }
}

interface GuardedObject {
  id: string
  title?: string
  status?: string
  fields?: Record<string, unknown>
}

/**
 * GH206 — contraintes de transition (specs/GH206.md §2, design §4). Appelé par le `persist` des services
 * exigence, test et issue, et par le pré-contrôle des menus de statut. Seule lecture hors de l'objet : la
 * couverture de l'exigence, sur tout le workspace, quand `hasCoverageLink` s'applique.
 */
export class TransitionGuardService {
  constructor(private readonly coverage: Pick<TraceabilityService, 'hasCoverage'>) {}

  /** `before` null = création. Sans changement de statut ou sans règle : rien à contrôler, aucune lecture. */
  async check(
    repoPath: string,
    typeDef: ObjectTypeDefinition | null,
    before: { status?: string } | null,
    after: GuardedObject,
    workspaceDir?: string,
  ): Promise<TransitionCheck> {
    const to = after.status
    const from = before ? (before.status ?? null) : null
    if (!typeDef?.transitions?.length || !to || (before && from === to)) return { blocked: false, issues: [] }
    const covered = needsCoverage(typeDef, from, to)
      ? await this.coverage.hasCoverage(repoPath, after.id, workspaceDir)
      : true
    return evaluateTransition(typeDef, from, { ...after, status: to }, () => covered)
  }

  /**
   * Pré-contrôle des menus de statut : un résultat par statut du type, statut courant exclu, calculé comme
   * à l'écriture. La couverture est lue une fois au plus.
   */
  async preview(
    repoPath: string,
    typeDef: ObjectTypeDefinition | null,
    obj: GuardedObject,
    workspaceDir?: string,
  ): Promise<Record<string, TransitionCheck>> {
    const out: Record<string, TransitionCheck> = {}
    if (!typeDef?.transitions?.length) return out
    const from = obj.status ?? null
    let covered: boolean | undefined
    for (const status of typeDef.statuses ?? []) {
      if (status.name === from) continue
      if (covered === undefined && needsCoverage(typeDef, from, status.name)) {
        covered = await this.coverage.hasCoverage(repoPath, obj.id, workspaceDir)
      }
      out[status.name] = evaluateTransition(typeDef, from, { ...obj, status: status.name }, () => covered ?? true)
    }
    return out
  }

  /** Lève `TransitionBlockedError` si un motif bloque ; renvoie sinon les notifications (niveau `warn`). */
  async assert(
    repoPath: string,
    typeDef: ObjectTypeDefinition | null,
    before: { status?: string } | null,
    after: GuardedObject,
    workspaceDir?: string,
  ): Promise<TransitionIssue[]> {
    const result = await this.check(repoPath, typeDef, before, after, workspaceDir)
    if (result.blocked) throw new TransitionBlockedError(result.issues)
    return result.issues
  }
}
