import type { ProductVersion, ProjectSchema, VersionRequirementsPage } from '@polenta/types'
import { flattenSystemNodes, versionState } from '@polenta/types'
import type { TraceabilityService } from './traceability.service'
import { VersionError, type VersionsService } from './versions.service'
import { buildRequirementRows, frozenCoverage, liveCoverage, type RequirementCoverage } from './version-verification.util'

/**
 * GH439 — exigences d'une version (specs/GH439.md) : celles du repo, hors statut terminal, dans l'état de
 * la version (figé à `freeze.sha`, disque pour une version en cours), avec leur statut de vérification :
 * copie figée au passage released, ou couverture calculée à l'instant pour une version en cours.
 * Lecture seule : rien n'est écrit.
 */
export class VersionRequirementsService {
  constructor(
    private readonly versions: Pick<VersionsService, 'get' | 'versionType' | 'perimeterOf'>,
    private readonly traceability: Pick<TraceabilityService, 'getMatrix'>,
  ) {}

  async page(repoPath: string, versionId: string, workspaceDir?: string): Promise<VersionRequirementsPage> {
    const version = await this.versions.get(repoPath, versionId)
    const typeDef = (await this.versions.versionType(repoPath))?.typeDef ?? null
    const state = versionState(typeDef, version.status)
    // Abandonnée avant tout passage released : aucun état figé à lire (les éléments ont pu changer depuis).
    if (state === 'abandoned' && !version.freeze) throw new VersionError('VERSION_NOT_FROZEN', versionId)
    // Gel ou schéma illisible (clone partiel…) : l'erreur remonte, une liste vide laisserait croire à une version vide.
    const { schema, requirements } = await this.versions.perimeterOf(repoPath, version)
    const { verification, coverageOf } = await this.coverage(repoPath, version, workspaceDir)
    return {
      version: { id: version.id, title: version.title, state, freeze: version.freeze ?? null },
      verification,
      rows: buildRequirementRows(requirements, coverageOf),
      ...requirementDisplay(schema),
    }
  }

  /**
   * Origine de la colonne Vérification. Une version qui a un gel ne lit jamais l'état courant : sa copie
   * figée, ou rien (version released avant GH439). Seule une version en cours calcule la couverture.
   */
  private async coverage(repoPath: string, version: ProductVersion, workspaceDir?: string): Promise<{
    verification: VersionRequirementsPage['verification']
    coverageOf: (id: string) => RequirementCoverage | null
  }> {
    if (version.freeze) {
      return version.verification
        ? { verification: 'frozen', coverageOf: frozenCoverage(version.verification) }
        : { verification: 'missing', coverageOf: () => null }
    }
    // Sans matrice, toutes les exigences paraîtraient non couvertes : l'erreur remonte.
    const matrix = await this.traceability.getMatrix(repoPath, {}, workspaceDir)
    return { verification: 'live', coverageOf: liveCoverage(matrix) }
  }
}

/** Champs, libellés de type (par `objectTypeRef`) et de statut des types d'exigence du schéma. */
function requirementDisplay(schema: ProjectSchema | null): Pick<VersionRequirementsPage, 'requirementFields' | 'requirementTypeLabels' | 'requirementStatusLabels'> {
  const typed = flattenSystemNodes(schema?.nodes ?? [])
    .flatMap(({ node }) => (node.objectTypes ?? []).map(t => ({ ref: `${node.name}::${t.name}`, type: t })))
    .filter(({ type }) => type.category === 'requirement')
  const fields = new Map(typed.flatMap(({ type }) => type.fields ?? []).map(f => [f.name, f]))
  return {
    requirementFields: [...fields.values()],
    requirementTypeLabels: Object.fromEntries(typed.map(({ ref, type }) => [ref, type.label || type.name])),
    requirementStatusLabels: Object.fromEntries(typed.flatMap(({ type }) => type.statuses ?? []).map(s => [s.name, s.label || s.name])),
  }
}
