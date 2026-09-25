import type { ObjectTypeDefinition, ProjectSchema, SystemNode } from '@polenta/types'
import { findSystemNode, flattenSystemNodes } from '@polenta/types'

/**
 * System columns always present on a query-engine dataset row, independent of
 * schema.yaml — shared between query-engine.service.ts (builder → SQL field
 * allowlist) and saved-queries.service.ts (history purge validation) so the two
 * don't drift out of sync.
 */
export const SYSTEM_QUERY_FIELDS = [
  'id', 'objectTypeRef', 'title', 'status', 'component',
  'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'needsRevalidation',
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

/**
 * Retrouve le `SystemNode` propriétaire de `resolved` (l'objet renvoyé par
 * `findObjectTypeDef`, littéralement l'un des éléments de `node.objectTypes[]`) — par
 * égalité de référence quand `objectTypeRef` n'a pas de préfixe de nœud explicite
 * (recherche `findObjectTypeDef` elle-même en itérant les nœuds), pour retomber sur
 * exactement le même nœud qu'elle a trouvé même si plusieurs nœuds déclarent un type
 * de même nom (T113 : des `SystemNode` frères peuvent réutiliser un nom de type). Déplacé depuis
 * `bulk-import-validation.util.ts` (T172, partagé avec `isRefInReadonlyNode`).
 */
export function findOwningNode(
  schema: ProjectSchema,
  objectTypeRef: string,
  resolved: ObjectTypeDefinition,
): SystemNode | undefined {
  const nodeName = objectTypeRef.includes('::') ? objectTypeRef.split('::')[0] : undefined
  // T123 — nodeName peut désigner un composant local imbriqué à n'importe quelle profondeur.
  if (nodeName && nodeName !== 'root') {
    return findSystemNode(schema.nodes, nodeName)
  }
  return flattenSystemNodes(schema.nodes).find(({ node }) => node.objectTypes?.includes(resolved))?.node
}

/**
 * Retrouve le `SystemNode` LOCAL désigné par le préfixe `<nodeName>::` d'un
 * `objectTypeRef` dont le TYPE est `'unresolvable'` (nœud submodule sans
 * `objectTypes` inlinés, ou nœud carrément absent de `schema.nodes`). Contrairement à
 * `findOwningNode`, ne peut pas s'appuyer sur une égalité de référence avec un
 * `ObjectTypeDefinition` déjà résolu (il n'y en a pas) — se contente donc de retrouver
 * le nœud par nom quand `objectTypeRef` a un préfixe explicite (`nodeName::typeName`).
 * Un `objectTypeRef` sans préfixe (juste un nom de type, jamais trouvé dans aucun
 * nœud local) n'a par construction aucun nœud à retrouver ici.
 */
export function findLocalNodeByRefPrefix(schema: ProjectSchema, objectTypeRef: string): SystemNode | undefined {
  if (!objectTypeRef.includes('::')) return undefined
  const nodeName = objectTypeRef.split('::')[0]
  if (nodeName === 'root') return undefined
  return findSystemNode(schema.nodes, nodeName)
}

/**
 * T172 — l'`objectTypeRef` appartient-il à un nœud déclaré `readonly: true` dans `schema` ?
 * Même résolution que la validation bulk-import (`bulk-import-validation.util.ts`) : nœud
 * propriétaire du type résolu, sinon nœud local désigné par le préfixe quand le type est
 * `'unresolvable'` (nœud submodule sans `objectTypes` inlinés).
 */
export function isRefInReadonlyNode(schema: ProjectSchema, objectTypeRef: string): boolean {
  const resolved = findObjectTypeDef(schema, objectTypeRef)
  if (resolved === null) return false
  const node = resolved === 'unresolvable'
    ? findLocalNodeByRefPrefix(schema, objectTypeRef)
    : findOwningNode(schema, objectTypeRef, resolved)
  return !!node?.readonly
}
