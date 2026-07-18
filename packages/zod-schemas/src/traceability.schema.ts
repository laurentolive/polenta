import { z } from 'zod'

export const MatrixFiltersSchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  parentId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  testType: z.enum(['manual', 'automated', 'semi-automated']).optional(),
})

export const AcknowledgeImpactSchema = z.object({
  elementId: z.string().min(1),
  elementType: z.enum(['requirement', 'test_case']),
  comment: z.string().nullable().default(null),
})

export const GenerateTestPlanSchema = z.object({
  title: z.string().min(1).max(500),
  requirementIds: z.array(z.string()).optional(),
  requirementTypes: z.array(z.string()).optional(),
  requirementTags: z.array(z.string()).optional(),
  testCaseFilter: z.enum(['approved_only', 'include_draft']).default('approved_only'),
  coverageFilter: z.enum(['full_only', 'all']).default('all'),
})

export type MatrixFiltersDto = z.infer<typeof MatrixFiltersSchema>
export type AcknowledgeImpactDto = z.infer<typeof AcknowledgeImpactSchema>
export type GenerateTestPlanDto = z.infer<typeof GenerateTestPlanSchema>
