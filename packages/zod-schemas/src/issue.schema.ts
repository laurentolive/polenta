import { z } from 'zod'

const IssueOriginSchema = z.object({
  runs: z.array(z.string().min(1)).optional(),
  decisions: z.array(z.string().min(1)).optional(),
})

export const CreateIssueSchema = z.object({
  objectTypeRef: z.string().min(1),
  title: z.string().min(1).max(500),
  /** Facultatif : à défaut, premier statut du type dans le schéma. */
  status: z.string().min(1).optional(),
  fields: z.record(z.unknown()).default({}),
  origin: IssueOriginSchema.optional(),
})

export const UpdateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  status: z.string().min(1).optional(),
  fields: z.record(z.unknown()).optional(),
  modificationComment: z.string().optional(),
})

export type CreateIssueDto = z.input<typeof CreateIssueSchema>
export type UpdateIssueDto = z.infer<typeof UpdateIssueSchema>
