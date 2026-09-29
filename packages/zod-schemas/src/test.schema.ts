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
})

export type CreateTestCaseDto = z.infer<typeof CreateTestCaseSchema>
export type UpdateTestCaseDto = z.infer<typeof UpdateTestCaseSchema>
export type ExecuteTestCaseDto = z.infer<typeof ExecuteTestCaseSchema>
