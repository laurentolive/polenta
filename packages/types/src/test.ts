// ─── Test Case Definition ─────────────────────────────────────────────────────

export interface EquipmentRequirement {
  id: string
  role: string
  description: string
  required: boolean
  quantity: number
}

export interface TestStep {
  order: number
  action: string          // HTML (RICHTEXT)
  expectedResult: string  // HTML (RICHTEXT)
  notes: string | null    // HTML (RICHTEXT)
}

// objectTypeRef format : "componentName::objectTypeName"
// Les liens vers d'autres objets passent par ObjectLink et sont accédés via l'API links.
export interface TestCase {
  id: string
  projectId: string
  branchId: string
  title: string
  objectTypeRef: string
  status: string
  version?: number
  preconditions: string        // HTML (RICHTEXT)
  equipment: EquipmentRequirement[]
  steps: TestStep[]
  postconditions: string       // HTML (RICHTEXT)
  fields: Record<string, unknown>
  // T172 — impact à vérifier (cf. Requirement.needsRevalidation).
  needsRevalidation?: boolean
  // Dérivés du git log du fichier (premier/dernier commit le touchant), pas persistés
  // dans le YAML — `null` tant que le fichier n'a jamais été commité.
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}

// ─── Test Execution ───────────────────────────────────────────────────────────

export type StepResultValue = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP' | 'NOT_EXECUTED'
export type TestRunResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'

// Labels FR partagés — évite qu'un générateur d'export (main process, pas d'accès aux composants
// renderer) ne réintroduise ses propres libellés divergents de ceux affichés à l'écran
// (campaign.$campaignId.tsx) pour les mêmes valeurs de `TestRunStatus` (cf. `campaign.ts`).
export const TEST_RUN_STATUS_LABELS: Record<'pending' | 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE', string> = {
  pending: 'En attente',
  PASS: 'Passé',
  FAIL: 'Échoué',
  BLOCKED: 'Bloqué',
  INCOMPLETE: 'Incomplet',
}

export interface EquipmentUsed {
  equipmentId: string
  role: string
  identification: string
  calibrationDate: string | null
  notes: string | null
}

export interface StepResult {
  order: number
  result: StepResultValue
  comment: string              // HTML (RICHTEXT)
  executedAt: string | null
}

export interface TestRun {
  id: string
  testCaseId: string
  campaignRunId: string | null
  /** T179 — exigence de l'instance de campagne exécutée : le run ne compte, en couverture, que pour
   *  elle. Absent : compte pour toutes les exigences liées au test. */
  requirementId?: string
  result: TestRunResult
  executedAt: string
  executedBy: string
  duration: number             // seconds
  equipmentUsed: EquipmentUsed[]
  stepResults: StepResult[]
  notes: string                // HTML (RICHTEXT)
}

// ─── Campaigns ───────────────────────────────────────────────────────────────
