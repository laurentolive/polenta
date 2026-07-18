import { z } from 'zod'

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
})

export const CreateBranchSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_\-/]+$/),
  fromBranchId: z.string().optional(),
})

export type CreateProjectDto = z.infer<typeof CreateProjectSchema>
export type CreateBranchDto = z.infer<typeof CreateBranchSchema>
