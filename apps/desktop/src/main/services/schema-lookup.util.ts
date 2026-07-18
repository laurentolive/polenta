import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'

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

  if (nodeName && nodeName !== 'root') {
    const node = schema.nodes.find((n) => n.name === nodeName)
    if (!node || node.objectTypes === undefined) return 'unresolvable'
    return node.objectTypes.find((t) => t.name === typeName) ?? null
  }

  for (const node of schema.nodes) {
    const found = node.objectTypes?.find((t) => t.name === typeName)
    if (found) return found
  }
  return null
}
