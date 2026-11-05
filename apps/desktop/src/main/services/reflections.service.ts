import { validationState } from '@polenta/types'
import type { RequirementReflections, RequirementReflectionsList } from '@polenta/types'
import type { SchemaService } from './schema.service'
import type { ValidationsService } from './validations.service'
import type { VersionsService } from './versions.service'

/**
 * GH210 — reflets des vues exigence (specs/GH210.md) : statut de design (première version released qui inclut
 * l'exigence avec un état identique) et décision de la **dernière validation signée** du composant, selon l'ordre
 * des livraisons de sa version (D1). Une validation annulée ne compte plus (D2) ; une exigence sans entrée n'a pas
 * de reflet de validation (D3). Rien n'est stocké.
 */
export class ReflectionsService {
  constructor(
    private readonly schema: Pick<SchemaService, 'resolveComponentRepoPath'>,
    private readonly versions: Pick<VersionsService, 'designOf' | 'releasedVersions'>,
    private readonly validations: Pick<ValidationsService, 'list' | 'validationType'>,
  ) {}

  /** Reflets des exigences du repo propriétaire de `objectTypeRef` (sous-composant compris), par ID. */
  async list(repoPath: string, objectTypeRef: string, workspaceDir?: string): Promise<RequirementReflectionsList> {
    const owner = (await this.schema.resolveComponentRepoPath(repoPath, objectTypeRef, workspaceDir)) ?? repoPath
    const [design, released, validations, vt] = await Promise.all([
      this.versions.designOf(owner),
      this.versions.releasedVersions(owner),
      this.validations.list(owner),
      this.validations.validationType(owner),
    ])
    const out: Record<string, RequirementReflections> = {}
    const at = (id: string) => (out[id] ??= {})
    for (const [reqId, v] of design) at(reqId).design = { versionId: v.id, versionLabel: v.title }

    // D1 — dernière validation signée dans l'ordre des livraisons de sa version, pas des signatures.
    const order = new Map(released.map((v, i) => [v.id, i]))
    const signed = validations
      .filter(v => validationState(vt?.typeDef, v.status) === 'signed' && order.has(v.versionId))
      .sort((a, b) => order.get(a.versionId)! - order.get(b.versionId)!)
      .at(-1)
    if (signed) {
      const version = released[order.get(signed.versionId)!]
      const labelOf = (decision: string) => vt?.typeDef.decisions?.find(d => d.name === decision)?.label ?? decision
      for (const entry of signed.entries) {
        at(entry.requirementId).validation = {
          decision: entry.decision, decisionLabel: labelOf(entry.decision),
          validationId: signed.id, versionId: version.id, versionLabel: version.title,
        }
      }
    }
    return { repoPath: owner, requirements: out }
  }
}
