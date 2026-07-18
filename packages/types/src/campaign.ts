import type { TestCase } from './test'

export type CampaignStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned'
export type TestRunStatus = 'pending' | 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'

export interface TestCampaign {
  id: string           // CAMP-0001
  title: string
  objectTypeRef?: string
  fields: Record<string, unknown>
  baselineRef?: string
  component?: string
  level?: string
  status: CampaignStatus
  testCaseIds: string[]
  runs: CampaignTestRun[]
  createdAt: string
  completedAt?: string | null
}

export interface CampaignTestRun {
  /** Identifiant unique de cette inclusion du test dans la campagne (ex. `TEST-0042-2`
   *  pour la 2e instance de TEST-0042) — distinct de `testCaseId` car un même test peut
   *  être inclus plusieurs fois s'il a des paramètres (T97 sprint 2). */
  entryId: string
  testCaseId: string
  /** Copie complète du `TestCase` au moment de l'inclusion dans la campagne (T49) — fige
   *  contenu/statut, indépendamment des modifications ultérieures de la source. Absent sur
   *  les entrées créées avant T49 (pas de backfill rétroactif, décision de cadrage) : ces
   *  entrées continuent de se résoudre contre l'état live du test. */
  testSnapshot?: TestCase
  status: TestRunStatus
  runId?: string
  executedAt?: string
  executedBy?: string
  paramValues?: Record<string, string>
}

export interface CreateCampaignDto {
  title: string
  objectTypeRef?: string
  fields?: Record<string, unknown>
  baselineRef?: string
  component?: string
  level?: string
  testCaseIds: string[]
  paramValuesByTest?: Record<string, Record<string, string>>
}

export interface UpdateCampaignDto {
  title?: string
  objectTypeRef?: string
  fields?: Record<string, unknown>
}
