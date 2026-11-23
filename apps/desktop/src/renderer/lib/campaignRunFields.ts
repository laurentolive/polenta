import type { ExecutionHistoryRow, ObjectTypeDefinition, ProjectSchema, SchemaField } from '@polenta/types'
import { flattenSystemNodes } from '@polenta/types'

// GH428 — champs d'exécution dans la grille des entrées de campagne : colonnes `run:<nom>` et valeur du
// dernier run de chaque entrée. Fonctions pures, sans appel réseau (testables hors navigateur).

/** Préfixe des clés de colonne des champs d'exécution (comme la Vue Exécutions). */
export const RUN_COLUMN_PREFIX = 'run:'

/** Type de test d'une référence `<nœud>::<type>` (nœud local à toute profondeur, comme `getTestTypeDef`). */
function testTypeDef(schema: ProjectSchema | undefined, objectTypeRef: string): ObjectTypeDefinition | undefined {
  if (!schema) return undefined
  const [nodeName, typeName] = objectTypeRef.includes('::') ? objectTypeRef.split('::') : [undefined, objectTypeRef]
  for (const { node } of flattenSystemNodes(schema.nodes)) {
    if (nodeName && node.name !== nodeName) continue
    const found = node.objectTypes?.find(t => t.name === typeName && t.category === 'test')
    if (found) return found
  }
  return undefined
}

/** Champs d'exécution (`runFields`) des types de test donnés, union par nom, dans l'ordre de déclaration. */
export function campaignRunFieldDefs(schema: ProjectSchema | undefined, objectTypeRefs: string[]): SchemaField[] {
  const out: SchemaField[] = []
  for (const ref of objectTypeRefs) {
    for (const field of testTypeDef(schema, ref)?.runFields ?? []) {
      if (!out.some(o => o.name === field.name)) out.push(field)
    }
  }
  return out
}

/**
 * Valeurs de champs d'exécution du dernier run de chaque entrée de la campagne. « Dernier » = `executedAt`
 * le plus récent parmi les runs rattachés à l'entrée (une entrée peut avoir plusieurs runs : retests).
 */
export function lastRunFieldsByEntry(rows: ExecutionHistoryRow[], campaignId: string): Map<string, Record<string, unknown>> {
  const latest = new Map<string, { at: string; fields: Record<string, unknown> }>()
  for (const row of rows) {
    if (row.kind !== 'run' || !row.run || row.campaign?.id !== campaignId || !row.entry) continue
    const at = row.run.executedAt ?? ''
    const known = latest.get(row.entry.entryId)
    if (!known || at > known.at) latest.set(row.entry.entryId, { at, fields: row.run.fields ?? {} })
  }
  return new Map([...latest].map(([entryId, v]) => [entryId, v.fields]))
}

/** Type de test de chaque entrée de la campagne (`objectTypeRef`), sans doublon. */
export function uniqueTypeRefs(refs: (string | undefined)[]): string[] {
  return [...new Set(refs.filter((r): r is string => !!r))]
}
