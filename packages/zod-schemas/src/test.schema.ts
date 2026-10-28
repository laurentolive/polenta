import { z } from 'zod'

export const EquipmentRequirementSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  description: z.string(),
  required: z.boolean(),
  quantity: z.number().int().positive(),
})

export const TestStepSchema = z.object({
  order: z.number().int().positive(),
  action: z.string().min(1),
  expectedResult: z.string().min(1),
  notes: z.string().nullable().default(null),
})

export const CreateTestCaseSchema = z.object({
  title: z.string().min(1).max(500),
  objectTypeRef: z.string().min(1),
  /** GH149 — facultatif : à défaut, premier statut du type dans le schéma. */
  status: z.string().min(1).optional(),
  preconditions: z.string().optional(),
  equipment: z.array(EquipmentRequirementSchema).optional(),
  steps: z.array(TestStepSchema),
  postconditions: z.string().optional(),
  fields: z.record(z.unknown()).optional(),
})

export const UpdateTestCaseSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  objectTypeRef: z.string().optional(),
  status: z.string().optional(),
  preconditions: z.string().optional(),
  equipment: z.array(EquipmentRequirementSchema).optional(),
  steps: z.array(TestStepSchema).optional(),
  postconditions: z.string().optional(),
  fields: z.record(z.unknown()).optional(),
  /** GH163 — conservé sur les entrées d'historique créées par la modification. */
  modificationComment: z.string().optional(),
})

export const StepResultSchema = z.object({
  order: z.number().int().positive(),
  result: z.enum(['PASS', 'FAIL', 'BLOCKED', 'SKIP', 'NOT_EXECUTED']),
  comment: z.string().default(''),
})

export const EquipmentUsedSchema = z.object({
  equipmentId: z.string().min(1),
  role: z.string().min(1),
  identification: z.string().min(1),
  calibrationDate: z.string().datetime().nullable().default(null),
  notes: z.string().nullable().default(null),
})

export const ExecuteTestCaseSchema = z.object({
  stepResults: z.array(StepResultSchema),
  equipmentUsed: z.array(EquipmentUsedSchema).optional(),
  notes: z.string().optional(),
  result: z.enum(['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE']).optional(),
  /** T179 — exigence de l'instance de campagne exécutée (couverture par exigence). */
  requirementId: z.string().optional(),
  /** GH36 — import d'un classeur d'exécution : testeur, date et origine lus dans le fichier.
   *  Absents : exécution dans l'outil (date = maintenant). */
  executedBy: z.string().optional(),
  executedAt: z.string().datetime({ offset: true }).optional(),
  origin: z.literal('excel-import').optional(),
  /** GH73 — entrée de campagne exécutée : le run lui est rattaché. Absent : exécution isolée. */
  campaignEntry: z.object({ campaignId: z.string().min(1), entryId: z.string().min(1) }).optional(),
})

export type CreateTestCaseDto = z.infer<typeof CreateTestCaseSchema>
export type UpdateTestCaseDto = z.infer<typeof UpdateTestCaseSchema>
export type ExecuteTestCaseDto = z.infer<typeof ExecuteTestCaseSchema>
