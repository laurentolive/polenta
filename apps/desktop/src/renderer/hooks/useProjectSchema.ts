import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ProjectSchema, ObjectTypeDefinition } from '@polenta/types'

export function useProjectSchema(repoPath: string) {
  return useQuery<ProjectSchema>({
    queryKey: ['schema', repoPath],
    queryFn: () => api.schema.get(repoPath),
    enabled: !!repoPath,
    staleTime: Infinity,
  })
}

// Returns all ObjectTypeDefinition of category 'requirement' across all local nodes
export function getReqTypeDef(schema: ProjectSchema | undefined, objectTypeRef: string): ObjectTypeDefinition | undefined {
  if (!schema) return undefined
  // objectTypeRef format: "componentName::objectTypeName"
  const [compName, typeName] = objectTypeRef.includes('::')
    ? objectTypeRef.split('::')
    : [undefined, objectTypeRef]
  for (const node of schema.nodes) {
    if (compName && node.name !== compName) continue
    const found = node.objectTypes?.find(t => t.name === typeName && t.category === 'requirement')
    if (found) return found
  }
  return undefined
}

// Returns all ObjectTypeDefinition of category 'test' across all local nodes
export function getTestTypeDef(schema: ProjectSchema | undefined, objectTypeRef: string): ObjectTypeDefinition | undefined {
  if (!schema) return undefined
  const [compName, typeName] = objectTypeRef.includes('::')
    ? objectTypeRef.split('::')
    : [undefined, objectTypeRef]
  for (const node of schema.nodes) {
    if (compName && node.name !== compName) continue
    const found = node.objectTypes?.find(t => t.name === typeName && t.category === 'test')
    if (found) return found
  }
  return undefined
}

// Returns all ObjectTypeDefinition of category 'campaign' across all local nodes
export function getCampaignTypeDef(schema: ProjectSchema | undefined, objectTypeRef: string | undefined): ObjectTypeDefinition | undefined {
  if (!schema || !objectTypeRef) return undefined
  const [compName, typeName] = objectTypeRef.includes('::')
    ? objectTypeRef.split('::')
    : [undefined, objectTypeRef]
  for (const node of schema.nodes) {
    if (compName && node.name !== compName) continue
    const found = node.objectTypes?.find(t => t.name === typeName && t.category === 'campaign')
    if (found) return found
  }
  return undefined
}

// Collect all objectTypes of a given category from all local nodes
export function getAllObjectTypes(schema: ProjectSchema | undefined, category: 'requirement' | 'test' | 'campaign'): ObjectTypeDefinition[] {
  if (!schema) return []
  return schema.nodes.flatMap(n => (n.objectTypes ?? []).filter(t => t.category === category))
}
