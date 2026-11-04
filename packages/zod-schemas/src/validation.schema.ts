import { z } from 'zod'

export const CreateValidationSchema = z.object({
  versionId: z.string().min(1),
  title: z.string().min(1).max(500),
  fields: z.record(z.unknown()).default({}),
})

export const UpdateValidationSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  fields: z.record(z.unknown()).optional(),
})

export const ValidationDecisionSchema = z.object({
  requirementId: z.string().min(1),
  decision: z.string().min(1),
  comment: z.string().optional(),
  fields: z.record(z.unknown()).optional(),
})

export type CreateValidationDto = z.input<typeof CreateValidationSchema>
export type UpdateValidationDto = z.infer<typeof UpdateValidationSchema>
export type ValidationDecisionDto = z.infer<typeof ValidationDecisionSchema>
