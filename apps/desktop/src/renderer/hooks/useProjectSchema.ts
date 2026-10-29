import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ProjectSchema, ObjectCategory, ObjectTypeDefinition, TestCase } from '@polenta/types'
import { findSystemNode, flattenSystemNodes, isApprovalStatus } from '@polenta/types'

export function useProjectSchema(repoPath: string) {
  return useQuery<ProjectSchema>({
    queryKey: ['schema', repoPath],
    queryFn: () => api.schema.get(repoPath),
    enabled: !!repoPath,
    staleTime: Infinity,
  })
}

// Looks up an ObjectTypeDefinition of the given category by objectTypeRef ("nodeName::typeName").
// nodeName can designate a local component nested at any depth (SystemNode.children, T123) —
// not just a top-level node — so lookup must recurse, same as schema-lookup.util.ts on the main
// process side (findObjectTypeDef). A flat loop over `schema.nodes` misses nested nodes entirely.
function findTypeDef(
  schema: ProjectSchema | undefined,
  objectTypeRef: string | undefined,
  category: ObjectCategory,
): ObjectTypeDefinition | undefined {
  if (!schema || !objectTypeRef) return undefined
  const [compName, typeName] = objectTypeRef.includes('::')
    ? objectTypeRef.split('::')
    : [undefined, objectTypeRef]

  if (compName && compName !== 'root') {
    const node = findSystemNode(schema.nodes, compName)
    return node?.objectTypes?.find(t => t.name === typeName && t.category === category)
  }

  for (const { node } of flattenSystemNodes(schema.nodes)) {
    const found = node.objectTypes?.find(t => t.name === typeName && t.category === category)
    if (found) return found
  }
  return undefined
}

// Returns all ObjectTypeDefinition of category 'requirement' across all local nodes
export function getReqTypeDef(schema: ProjectSchema | undefined, objectTypeRef: string): ObjectTypeDefinition | undefined {
  return findTypeDef(schema, objectTypeRef, 'requirement')
}

// Returns all ObjectTypeDefinition of category 'test' across all local nodes
export function getTestTypeDef(schema: ProjectSchema | undefined, objectTypeRef: string): ObjectTypeDefinition | undefined {
  return findTypeDef(schema, objectTypeRef, 'test')
}

// Statut "approuvé" résolu depuis `statuses[].isApproval` du type du test (schema.yaml), pas
// depuis le littéral 'approved' (repli sur 'approved' si le type n'en déclare pas) — même règle
// que field-checks.util.ts et CampaignsService.approvalPredicate côté main (GH68).
export function isTestApproved(test: TestCase, schema: ProjectSchema | undefined): boolean {
  return isApprovalStatus(getTestTypeDef(schema, test.objectTypeRef), test.status)
}

/** Libellé du statut d'un test (`statuses[].label` de son type), à défaut son nom. */
export function testStatusLabel(test: TestCase, schema: ProjectSchema | undefined): string {
  return getTestTypeDef(schema, test.objectTypeRef)?.statuses?.find(s => s.name === test.status)?.label ?? test.status
}

// Returns all ObjectTypeDefinition of category 'campaign' across all local nodes
export function getCampaignTypeDef(schema: ProjectSchema | undefined, objectTypeRef: string | undefined): ObjectTypeDefinition | undefined {
  return findTypeDef(schema, objectTypeRef, 'campaign')
}

/** GH198 — type d'un change (`objectTypeRef` <nœud>::<type>). */
export function getChangeTypeDef(schema: ProjectSchema | undefined, objectTypeRef: string | undefined): ObjectTypeDefinition | undefined {
  return findTypeDef(schema, objectTypeRef, 'change')
}

// Collect all objectTypes of a given category from all local nodes (any depth)
export function getAllObjectTypes(schema: ProjectSchema | undefined, category: ObjectCategory): ObjectTypeDefinition[] {
  if (!schema) return []
  return flattenSystemNodes(schema.nodes).flatMap(({ node }) => (node.objectTypes ?? []).filter(t => t.category === category))
}

export interface TestTypeRef {
  /** `<nœud>::<type>` — format de `objectTypeRef`. */
  ref: string
  label: string
  typeDef: ObjectTypeDefinition
}

/** GH33 — types `test` de tous les nœuds locaux, avec leur ref (`getAllObjectTypes` ne donne pas le
 *  nom du nœud). Libellé préfixé du chemin du composant (`›`) quand le schéma a plusieurs nœuds. */
export function getTestTypeRefs(schema: ProjectSchema | undefined): TestTypeRef[] {
  return getObjectTypeRefs(schema, 'test')
}

/** GH146 — même chose pour une catégorie quelconque (types de campagne de `/campaign/new`). */
export function getObjectTypeRefs(schema: ProjectSchema | undefined, category: ObjectCategory): TestTypeRef[] {
  if (!schema) return []
  const flat = flattenSystemNodes(schema.nodes)
  return flat.flatMap(({ node, ancestors }) => (node.objectTypes ?? [])
    .filter(t => t.category === category)
    .map(t => ({
      ref: `${node.name}::${t.name}`,
      label: flat.length > 1
        ? [...ancestors, node].map(n => n.label || n.name).concat(t.label || t.name).join(' › ')
        : t.label || t.name,
      typeDef: t,
    })))
}
