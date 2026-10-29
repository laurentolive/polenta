import type { DiffNode } from '@polenta/merge-core'
import type { ObjectTypeDefinition, SchemaField } from '@polenta/types'

/**
 * GH222 — présentation d'un arbre de différences dans la vue générique : libellé de chaque nœud
 * dans la colonne Structure, nœuds masqués, ordre des enfants, et façon de rendre une valeur.
 * Générique pour tout YAML ; pour un objet typé (exigence, test, campagne), les libellés, l'ordre
 * et le rendu des valeurs viennent du schéma (spec §4.2) — le cadre reste celui de la vue générique.
 */

export type ValueKind = 'title' | 'status' | 'richtext' | 'field' | 'text'

export interface Presentation {
  label(node: DiffNode): string
  hidden(node: DiffNode): boolean
  order(parent: DiffNode, children: DiffNode[]): DiffNode[]
  render(node: DiffNode): ValueKind
  /** Nœud montré comme une seule valeur, sans enfants (un `multi_enum` stocké en liste). */
  leaf(node: DiffNode): boolean
  field(node: DiffNode): SchemaField | undefined
  /** Clé d'unité GH178 (`title`, `fields.statement`) : ancre `data-unit` stable. */
  unitKey(node: DiffNode): string | undefined
  /** Étape d'un test : `i:j` (indexes Avant / Après alignés). */
  stepRow(node: DiffNode): string | undefined
}

type T = (key: string, opts?: Record<string, unknown>) => string

const keyOf = (node: DiffNode, at: number) => {
  const s = node.path[at]
  return s && 'k' in s ? s.k : undefined
}

const isMultiline = (v: unknown) => typeof v === 'string' && v.includes('\n')

export const genericPresentation: Presentation = {
  label: n => n.label,
  hidden: () => false,
  order: (_p, children) => children,
  render: n => (isMultiline(n.after ?? n.before) ? 'text' : 'field'),
  leaf: () => false,
  field: () => undefined,
  unitKey: () => undefined,
  stepRow: () => undefined,
}

/** Not shown: identity of the object (in the column title) and `history`, which changes on every
 *  write and repeats the status — all visible in Raw (GH178 §2.2). */
const HIDDEN_ROOT = new Set(['id', 'projectId', 'branchId', 'objectTypeRef', 'history'])
const ROOT_ORDER = ['title', 'status', 'preconditions', 'fields', 'steps', 'postconditions']
const STEP_ORDER = ['action', 'expectedResult', 'notes']
const RICH_ROOT = new Set(['preconditions', 'postconditions'])

function sortBy<T>(items: T[], rank: (x: T) => number): T[] {
  return items.map((x, i) => ({ x, i, r: rank(x) })).sort((a, b) => a.r - b.r || a.i - b.i).map(e => e.x)
}

export function typedPresentation(typeDef: ObjectTypeDefinition | undefined, t: T): Presentation {
  const fields = (typeDef?.fields ?? []) as SchemaField[]
  const fieldOf = (name: string | undefined) => fields.find(f => f.name === name)
  const where = (n: DiffNode) => ({ depth: n.path.length, a: keyOf(n, 0), b: keyOf(n, 1), c: keyOf(n, 2) })

  return {
    label(n) {
      const { depth, a, b, c } = where(n)
      if (depth === 1 && a) {
        if (a === 'fields') return t('treediff.fields')
        return ROOT_ORDER.includes(a) ? t(`diffView.unit.${a}`) : a
      }
      if (depth === 2 && a === 'fields') return fieldOf(b)?.label ?? n.label
      if (depth === 2 && a === 'steps') {
        const [i, j] = n.indexes ?? [null, null]
        return t('diffView.stepNumber', { n: (j ?? i ?? 0) + 1 })
      }
      if (depth === 3 && a === 'steps') {
        if (c === 'action') return t('diffView.stepAction')
        if (c === 'expectedResult') return t('diffView.stepExpected')
        if (c === 'notes') return t('treediff.stepNotes')
      }
      return n.label
    },
    hidden(n) {
      const { depth, a, c } = where(n)
      if (depth === 1 && a && HIDDEN_ROOT.has(a)) return true
      // A step's number is its place in the list.
      return depth === 3 && a === 'steps' && c === 'order'
    },
    order(parent, children) {
      const { depth, a } = where(parent)
      if (depth === 0) return sortBy(children, c => { const r = ROOT_ORDER.indexOf(keyOf(c, 0) ?? ''); return r < 0 ? ROOT_ORDER.length : r })
      if (depth === 1 && a === 'fields') {
        return sortBy(children, c => { const r = fields.findIndex(f => f.name === keyOf(c, 1)); return r < 0 ? fields.length : r })
      }
      if (depth === 2 && a === 'steps') return sortBy(children, c => { const r = STEP_ORDER.indexOf(keyOf(c, 2) ?? ''); return r < 0 ? STEP_ORDER.length : r })
      return children
    },
    render(n) {
      const { depth, a, c } = where(n)
      if (depth === 1 && a === 'title') return 'title'
      if (depth === 1 && a === 'status') return 'status'
      if (depth === 1 && a && RICH_ROOT.has(a)) return 'richtext'
      if (depth === 2 && a === 'fields') {
        const f = this.field(n)
        if (f?.type === 'richtext') return 'richtext'
        if (f?.type === 'text' || (!f && isMultiline(n.after ?? n.before))) return 'text'
        return 'field'
      }
      if (depth === 3 && a === 'steps' && (c === 'action' || c === 'expectedResult')) return 'richtext'
      return isMultiline(n.after ?? n.before) ? 'text' : 'field'
    },
    leaf(n) {
      return this.field(n)?.type === 'multi_enum'
    },
    field(n) {
      const { depth, a, b } = where(n)
      return depth === 2 && a === 'fields' ? fieldOf(b) : undefined
    },
    unitKey(n) {
      const { depth, a, b } = where(n)
      if (depth === 1) return a
      if (depth === 2 && a === 'fields' && b) return `fields.${b}`
      return undefined
    },
    stepRow(n) {
      const { depth, a } = where(n)
      if (depth !== 2 || a !== 'steps' || !n.indexes) return undefined
      const [i, j] = n.indexes
      return `${i ?? '-'}:${j ?? '-'}`
    },
  }
}
