import type { ObjectTypeDefinition, TypeTreeNode } from '@polenta/types'
import { treeFlatten } from '../hooks/useTreeState'

// Miroir de `ExcelView.getColumnLabel` (components/system/ExcelView.tsx) pour les colonnes
// système — seule source de vérité pour "quel libellé affiche-t-on pour telle clé de colonne",
// utilisée à la fois par l'écran et par l'export pour qu'ils ne divergent jamais (cf. bug
// post-validation : l'export avait ses propres colonnes fixes, sans rapport avec ce qui est
// réellement configuré/affiché dans ExcelView/WordView).
const SYSTEM_COLUMN_LABELS: Record<string, string> = {
  section: 'Section',
  name: 'Label',
  id: 'ID',
  status: 'Statut',
  version: 'Version',
  createdAt: 'Créé le',
  updatedAt: 'Modifié le',
  author: 'Auteur',
  steps: 'Étapes',
}

/** Libellé d'une colonne pour l'export — même résolution que `ExcelView.getColumnLabel`, sans les
 *  colonnes `link::*` (relations), non prises en charge par l'export (T43) : filtrées par
 *  `buildExportRows` avant construction des colonnes. */
export function getExportColumnLabel(col: string, typeDef: ObjectTypeDefinition | undefined): string {
  if (SYSTEM_COLUMN_LABELS[col]) return SYSTEM_COLUMN_LABELS[col]
  const field = typeDef?.fields.find(f => f.name === col)
  return field?.label ?? col
}

/**
 * Construit les colonnes/lignes d'export EXACTEMENT comme `ExcelView`/`WordView` les affichent —
 * seule fonction faisant ce travail, utilisée à la fois par `SystemView.tsx` (export en direct) et
 * par `print.requirements.tsx`/`print.tests.tsx` (export pdf, qui recharge ses propres données)
 * pour qu'ils ne puissent jamais diverger l'un de l'autre.
 *
 * Parcourt l'arbre (`root`) dans l'ordre visuel réel — pas une liste plate, dont l'ordre ne
 * correspond pas forcément à l'arbre. Résout `section` via `sectionNumbers`, `name` via le nom du
 * nœud (comme `NameCell` dans `ExcelView.tsx`, pas le titre de l'objet — les deux sont
 * habituellement synchronisés mais restent deux champs distincts), `steps` en nombre d'étapes
 * (comme la cellule compacte d'`ExcelView`, pas le détail action/résultat), les autres clés via
 * l'objet normalisé (`obj[key]`, même valeur que `getFieldValue` dans `ExcelView.tsx`).
 */
export function buildExportRows(
  fields: string[],
  root: TypeTreeNode[],
  objects: Record<string, string>[],
  sectionNumbers: Map<string, string>,
  stepsByObjectId: Map<string, unknown[]> | undefined,
  typeDef: ObjectTypeDefinition | undefined,
  filter: string,
): { columns: { key: string; label: string }[]; rows: Record<string, string>[] } {
  const exportFields = fields.filter(f => !f.startsWith('link::'))
  const columns = exportFields.map(key => ({ key, label: getExportColumnLabel(key, typeDef) }))
  const objectsById = new Map(objects.map(o => [o['id'], o]))
  const needle = filter.trim().toLowerCase()
  const rows: Record<string, string>[] = []

  for (const node of treeFlatten(root)) {
    if (node.kind !== 'item' || !node.objectId) continue
    const obj = objectsById.get(node.objectId)
    if (!obj) continue
    if (needle && !(obj['id']?.toLowerCase().includes(needle) || obj['title']?.toLowerCase().includes(needle))) continue

    const row: Record<string, string> = {}
    for (const key of exportFields) {
      if (key === 'section') row[key] = sectionNumbers.get(node.id) ?? ''
      else if (key === 'name') row[key] = node.name || ''
      else if (key === 'steps') row[key] = String(stepsByObjectId?.get(node.objectId)?.length ?? 0)
      else row[key] = obj[key] ?? ''
    }
    rows.push(row)
  }

  return { columns, rows }
}
