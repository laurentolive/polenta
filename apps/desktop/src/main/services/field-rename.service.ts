import { emptyFieldRenameResult, renameValues, valueHas } from '@polenta/types'
import type { FieldRename, FieldRenameResult, HistoryCarrier, ValueRename, ValueRenamePreview } from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { RequirementsService } from './requirements.service'
import type { TestsService } from './tests.service'

/**
 * GH77 — renommage de champs d'un type dans l'éditeur de schéma (spec §6.3, design §3.3) : appelé
 * après l'enregistrement du schéma, migre `fields.<ancien>` et `history.<ancien>` sur toutes les
 * exigences, tous les tests et toutes les campagnes du type, dans le repo du type. Pas de retour
 * arrière (même philosophie que `ElementMoveService`) : les objets non migrés sont listés.
 */
export class FieldRenameService {
  constructor(
    private readonly requirements: RequirementsService,
    private readonly tests: TestsService,
    private readonly campaigns: CampaignsService,
  ) {}

  async renameFields(repoPath: string, objectTypeRef: string, renames: FieldRename[]): Promise<FieldRenameResult> {
    const result = emptyFieldRenameResult()
    const valid = renames.filter(r => r.from && r.to && r.from !== r.to)
    if (valid.length === 0) return result
    for (const service of [this.requirements, this.tests, this.campaigns]) {
      try {
        await service.renameFieldKeys(repoPath, objectTypeRef, valid, result)
      } catch (err) {
        // L'étape entière a échoué avant le parcours par fichier (index illisible…).
        result.failed.push({ id: objectTypeRef, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return result
  }

  /**
   * GH82 — renommage de statuts / valeurs d'enum d'un type, après l'enregistrement du schéma : objets
   * du type (valeur et historique) et copies `testSnapshot` des campagnes du repo dont le test est de
   * ce type. Écriture brute, au mieux par fichier.
   */
  async renameValues(repoPath: string, objectTypeRef: string, renames: ValueRename[]): Promise<FieldRenameResult> {
    const result = emptyFieldRenameResult()
    const valid = renames.filter(r => r.from && r.to && r.from !== r.to)
    if (valid.length === 0) return result
    const steps: Array<() => Promise<void>> = [
      () => this.requirements.rewriteObjects(repoPath, objectTypeRef, o => renameValues(o, valid), result),
      () => this.tests.rewriteObjects(repoPath, objectTypeRef, o => renameValues(o, valid), result),
      () => this.campaigns.rewriteObjects(repoPath, objectTypeRef, o => renameValues(o, valid), result),
      // Sans effet si le type n'est pas un type de test (aucune copie de ce type).
      () => this.campaigns.rewriteSnapshots(repoPath, objectTypeRef, t => renameValues(t, valid), result),
    ]
    for (const step of steps) {
      try {
        await step()
      } catch (err) {
        result.failed.push({ id: objectTypeRef, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return result
  }

  /** GH82 — aperçu sans écriture : objets du type portant l'ancienne / la nouvelle valeur. */
  async previewValueRenames(repoPath: string, objectTypeRef: string, renames: ValueRename[]): Promise<ValueRenamePreview[]> {
    const objects: HistoryCarrier[] = [
      ...await this.requirements.findAll(repoPath, { type: objectTypeRef }),
      ...(await this.tests.findAll(repoPath)).filter(t => t.objectTypeRef === objectTypeRef),
      ...(await this.campaigns.list(repoPath)).filter(c => c.objectTypeRef === objectTypeRef),
    ]
    const valueOf = (o: HistoryCarrier, r: ValueRename) => (r.target.kind === 'status' ? o.status : o.fields?.[r.target.field])
    const multi = (r: ValueRename) => r.target.kind === 'field' && r.target.multi
    const sameTarget = (a: ValueRename, b: ValueRename) =>
      a.target.kind === b.target.kind && (a.target.kind === 'status' || (b.target.kind === 'field' && a.target.field === b.target.field))
    return renames.map(rename => ({
      rename,
      withOld: objects.filter(o => valueHas(valueOf(o, rename), multi(rename), rename.from)).length,
      // Nouvelle valeur elle-même renommée dans la même édition (échange) : pas de collision.
      withNew: renames.some(r => sameTarget(r, rename) && r.from === rename.to)
        ? 0
        : objects.filter(o => valueHas(valueOf(o, rename), multi(rename), rename.to)).length,
    }))
  }
}
