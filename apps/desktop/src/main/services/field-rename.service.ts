import { emptyFieldRenameResult } from '@polenta/types'
import type { FieldRename, FieldRenameResult } from '@polenta/types'
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
}
