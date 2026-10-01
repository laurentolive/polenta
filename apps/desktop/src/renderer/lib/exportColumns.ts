import type { ExportColumn, ObjectTypeDefinition, TemplateOutlineEntry, TypeTreeNode } from '@polenta/types'
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
  coverageStatus: 'Couverture',
}

/** Colonnes affichées par défaut (aucune préférence enregistrée pour le type) — même ordre pour la
 *  vue système, les exports pdf et le sélecteur de tests GH33 : section/name/id/status, `version`
 *  (exigence) ou `steps` (test), puis les 3 premiers champs personnalisés. */
export function defaultVisibleFields(typeDef: ObjectTypeDefinition | undefined): string[] {
  return [
    'section',
    'name',
    'id',
    'status',
    ...(typeDef?.category === 'requirement' ? ['version'] : []),
    ...(typeDef?.category === 'test' ? ['steps'] : []),
    ...(typeDef?.fields.slice(0, 3).map(f => f.name) ?? []),
  ]
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
): { columns: ExportColumn[]; rows: Record<string, string>[] } {
  const exportFields = getExportFields(fields)
  const objectsById = new Map(objects.map(o => [o['id'], o]))
  const needle = filter.trim().toLowerCase()
  const rows: Record<string, string>[] = []

  for (const node of treeFlatten(root)) {
    if (node.kind !== 'item' || !node.objectId) continue
    const obj = objectsById.get(node.objectId)
    if (!obj || !matchesFilter(obj, needle)) continue
    rows.push(buildRow(node, obj, exportFields, sectionNumbers, stepsByObjectId))
  }

  return { columns: buildColumns(exportFields, typeDef), rows }
}

/**
 * GH34 — arbre d'export pour un gabarit client : mêmes éléments, même ordre, mêmes valeurs que
 * `buildExportRows` (dont il partage le filtre et la construction de ligne), plus les dossiers
 * (avec leur profondeur, pour des titres hiérarchiques) et le détail des étapes de test. Un dossier
 * n'est gardé que s'il contient au moins un élément retenu par le filtre.
 */
export function buildExportOutline(
  fields: string[],
  root: TypeTreeNode[],
  objects: Record<string, string>[],
  sectionNumbers: Map<string, string>,
  stepsByObjectId: Map<string, ExportStep[]> | undefined,
  filter: string,
  typeDef?: ObjectTypeDefinition,
): TemplateOutlineEntry[] {
  const statusLabels = new Map((typeDef?.statuses ?? []).map(st => [st.name, st.label]))
  const exportFields = getExportFields(fields)
  const objectsById = new Map(objects.map(o => [o['id'], o]))
  const needle = filter.trim().toLowerCase()

  const walk = (nodes: TypeTreeNode[], level: number): TemplateOutlineEntry[] => {
    const out: TemplateOutlineEntry[] = []
    for (const node of nodes) {
      const section = sectionNumbers.get(node.id) ?? ''
      if (node.kind === 'item') {
        const obj = node.objectId ? objectsById.get(node.objectId) : undefined
        if (!node.objectId || !obj || !matchesFilter(obj, needle)) continue
        out.push({
          kind: 'item',
          level,
          section,
          name: node.name || '',
          values: buildRow(node, obj, exportFields, sectionNumbers, stepsByObjectId),
          statusLabel: statusLabels.get(obj['status'] ?? '') ?? obj['status'] ?? '',
          ...(stepsByObjectId ? { steps: stepsByObjectId.get(node.objectId) ?? [] } : {}),
        })
      } else {
        const children = walk(node.children, level + 1)
        if (children.length === 0) continue
        out.push({ kind: 'folder', level, section, name: node.name || '', values: {} }, ...children)
      }
    }
    return out
  }
  return walk(root, 1)
}

/** Étape de test telle qu'exportée (GH34 : détail pour les gabarits, nombre pour la colonne `steps`). */
export interface ExportStep {
  order: number
  action: string
  expectedResult: string
  notes: string
}

// coverageStatus (T138) est un badge dérivé (via traceability:matrix), pas une valeur stockée sur
// l'objet — obj[key] serait toujours vide dans l'export, donc exclu plutôt que d'afficher une
// colonne "Couverture" vide dans les documents générés.
function getExportFields(fields: string[]): string[] {
  return fields.filter(f => !f.startsWith('link::') && f !== 'coverageStatus')
}

function buildColumns(exportFields: string[], typeDef: ObjectTypeDefinition | undefined): ExportColumn[] {
  return exportFields.map(key => {
    const type = typeDef?.fields.find(f => f.name === key)?.type
    return { key, label: getExportColumnLabel(key, typeDef), ...(type ? { type } : {}) }
  })
}

function matchesFilter(obj: Record<string, string>, needle: string): boolean {
  return !needle || !!(obj['id']?.toLowerCase().includes(needle) || obj['title']?.toLowerCase().includes(needle))
}

function buildRow(
  node: TypeTreeNode,
  obj: Record<string, string>,
  exportFields: string[],
  sectionNumbers: Map<string, string>,
  stepsByObjectId: Map<string, unknown[]> | undefined,
): Record<string, string> {
  const row: Record<string, string> = {}
  for (const key of exportFields) {
    if (key === 'section') row[key] = sectionNumbers.get(node.id) ?? ''
    else if (key === 'name') row[key] = node.name || ''
    else if (key === 'steps') row[key] = String(stepsByObjectId?.get(node.objectId ?? '')?.length ?? 0)
    else row[key] = obj[key] ?? ''
  }
  return row
}

/**
 * T171 §10 — remplace les références de paramètres par leur valeur dans les colonnes d'export où
 * elles sont reconnues (§3) : champs text / textarea / richtext d'une exigence, preconditions /
 * postconditions d'un test. `substitute` laisse littérales les références non résolues et celles
 * écrites dans du code Markdown (même règle qu'à l'écran).
 */
export function substituteExportParams(
  rows: Record<string, string>[],
  typeDef: { category?: string; fields?: { name: string; type: string }[] } | null | undefined,
  substitute: (text: string) => string,
): Record<string, string>[] {
  const scanned = new Set(typeDef?.category === 'test'
    ? ['preconditions', 'postconditions']
    : (typeDef?.fields ?? []).filter(f => f.type === 'text' || f.type === 'textarea' || f.type === 'richtext').map(f => f.name))
  if (scanned.size === 0) return rows
  return rows.map(row => Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && scanned.has(k) && v.includes('{') ? substitute(v) : v]),
  ))
}
