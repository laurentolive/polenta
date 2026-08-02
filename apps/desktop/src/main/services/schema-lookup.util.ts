import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { findSystemNode, flattenSystemNodes } from '@polenta/types'

/**
 * System columns always present on a query-engine dataset row, independent of
 * schema.yaml — shared between query-engine.service.ts (builder → SQL field
 * allowlist) and saved-queries.service.ts (history purge validation) so the two
 * don't drift out of sync.
 */
export const SYSTEM_QUERY_FIELDS = [
  'id', 'objectTypeRef', 'title', 'status', 'component',
  'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version',
] as const

export type ResolvedObjectType = ObjectTypeDefinition | null | 'unresolvable'

/**
 * Look up an ObjectTypeDefinition by objectTypeRef ("nodeName::typeName") in a schema.
 *
 * Returns:
 * - the ObjectTypeDefinition if found locally,
 * - `null` if the node is known locally but doesn't declare that type (i.e. it was
 *   genuinely removed from the schema),
 * - `'unresolvable'` when the ref points at a submodule node whose objectTypes aren't
 *   declared in the local schema.yaml (per CLAUDE.md, a submodule node with no
 *   `objectTypes` delegates to the component's own schema.yaml, which this lookup
 *   has no access to) — callers should treat this as "can't verify" rather than
 *   "invalid", to avoid false-positive purges/rejections on cross-component refs.
 */
export interface ObjectTypeLocation {
  nodeName: string
  typeDef: ObjectTypeDefinition
}

/**
 * Same resolution as `findObjectTypeDef`, but also returns the `SystemNode.name` that
 * declares the type — needed to address its `.polenta/trees/<nodeName>/<typeName>.yaml`
 * (T138: object creation must insert into that tree, and doing so requires knowing which
 * node the ref actually resolved to, not just the type definition).
 */
export function resolveObjectTypeLocation(
  schema: ProjectSchema,
  objectTypeRef: string,
): ObjectTypeLocation | null | 'unresolvable' {
  if (typeof objectTypeRef !== 'string' || objectTypeRef.length === 0) return 'unresolvable'

  const [nodeName, typeName] = objectTypeRef.includes('::')
    ? objectTypeRef.split('::')
    : [undefined, objectTypeRef]

  if (nodeName && nodeName !== 'root') {
    const node = findSystemNode(schema.nodes, nodeName)
    if (!node || node.objectTypes === undefined) return 'unresolvable'
    const typeDef = node.objectTypes.find((t) => t.name === typeName)
    return typeDef ? { nodeName, typeDef } : null
  }

  for (const { node } of flattenSystemNodes(schema.nodes)) {
    const typeDef = node.objectTypes?.find((t) => t.name === typeName)
    if (typeDef) return { nodeName: node.name, typeDef }
  }
  return null
}

export function findObjectTypeDef(schema: ProjectSchema, objectTypeRef: string): ResolvedObjectType {
  // Defensive: `Requirement.objectTypeRef`/`TestCase.objectTypeRef` are typed as
  // always a non-empty string, but nothing normalizes hand-edited YAML at read time
  // (`requirements-index.service.ts` casts raw parsed YAML straight to `Requirement`).
  // A frontmatter missing `objectTypeRef` entirely would otherwise throw here
  // (`.includes` on `undefined`) and crash dataset construction for the WHOLE repo —
  // exactly the crash T77 sprint 3's maturity feature must not cause (found in review:
  // treated as `'unresolvable'`, same as any other ref this lookup can't verify).
  if (typeof objectTypeRef !== 'string' || objectTypeRef.length === 0) return 'unresolvable'

  const [nodeName, typeName] = objectTypeRef.includes('::')
    ? objectTypeRef.split('::')
    : [undefined, objectTypeRef]

  // T123 — nodeName peut désigner un composant local imbriqué à n'importe quelle profondeur
  // (SystemNode.children), pas seulement un nœud de premier niveau — recherche récursive.
  if (nodeName && nodeName !== 'root') {
    const node = findSystemNode(schema.nodes, nodeName)
    if (!node || node.objectTypes === undefined) return 'unresolvable'
    return node.objectTypes.find((t) => t.name === typeName) ?? null
  }

  for (const { node } of flattenSystemNodes(schema.nodes)) {
    const found = node.objectTypes?.find((t) => t.name === typeName)
    if (found) return found
  }
  return null
}
