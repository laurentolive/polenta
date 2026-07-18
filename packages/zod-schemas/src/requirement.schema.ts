import { z } from 'zod'

export const JiraLinkSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['IMPLEMENTS', 'RELATED_TO', 'ORIGINATED_FROM', 'BLOCKS']),
  summary: z.string(),
  status: z.string(),
  url: z.string().url(),
  linkedAt: z.string().datetime(),
  linkedBy: z.string(),
})

export const CreateRequirementSchema = z.object({
  objectTypeRef: z.string().min(1),
  title: z.string().min(1).max(500),
  fields: z.record(z.unknown()).default({}),
})

export const UpdateRequirementSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  fields: z.record(z.unknown()).optional(),
  modificationComment: z.string().optional(),
})

export const TransitionRequirementSchema = z.object({
  toStatus: z.string().min(1),
  comment: z.string().optional(),
})

export const AddJiraLinkSchema = JiraLinkSchema.pick({ key: true, type: true })

export const CreateRequirementLinkSchema = z.object({
  type: z.enum(['DERIVES_FROM', 'SATISFIES', 'DEPENDS_ON', 'CONFLICTS_WITH', 'REFINES']),
  targetId: z.string().min(1),
})

export type CreateRequirementDto = z.infer<typeof CreateRequirementSchema>
export type UpdateRequirementDto = z.infer<typeof UpdateRequirementSchema>
export type TransitionRequirementDto = z.infer<typeof TransitionRequirementSchema>
export type AddJiraLinkDto = z.infer<typeof AddJiraLinkSchema>
export type CreateRequirementLinkDto = z.infer<typeof CreateRequirementLinkSchema>
