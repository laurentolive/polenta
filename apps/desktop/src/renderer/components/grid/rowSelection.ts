import type { TypeTreeNode } from '@polenta/types'

/**
 * GH389 — sélection de lignes d'une grille (spec §1.9), sans DOM. Deux modes :
 *
 * - **lignes** (Vue Excel, Validation) : clic = la ligne seule, Maj+clic / Maj+↑↓ = plage depuis
 *   l'ancre, Ctrl+clic = bascule ; un clic simple sur une ligne déjà dans une sélection multiple ne la
 *   réduit pas (T149 : l'édition d'une cellule s'applique alors à toute la sélection) ;
 * - **cases** (sélecteur de tests GH33, backlog…) : un clic ajoute ou retire, case de groupe à trois
 *   états. La sélection porte sur des objectIds (elle survit au changement de type) ; aucun clic ne
 *   retire une ligne absente de `displayed` (masquée par un filtre, d'un autre type, ou sous un
 *   dossier replié).
 *
 * `displayed` : identifiants des lignes affichées, dans l'ordre (filtres appliqués). Une ancre absente
 * de `displayed` (masquée par un filtre) fait ignorer Maj.
 */

export interface RowSelectInput {
  selected: ReadonlySet<string>
  displayed: readonly string[]
  anchor: string | null
  target: string
  shift?: boolean
  ctrl?: boolean
}

export interface RowSelectResult {
  /** `null` : sélection inchangée (évite un re-rendu). */
  selected: Set<string> | null
  anchor: string | null
}

/** Plage entre l'ancre et la cible dans `displayed`, ou null si l'ancre n'y est pas (Maj ignoré). */
function rangeOf(displayed: readonly string[], anchor: string | null, target: string): string[] | null {
  if (anchor === null) return null
  const a = displayed.indexOf(anchor)
  const b = displayed.indexOf(target)
  if (a < 0 || b < 0) return null
  return displayed.slice(Math.min(a, b), Math.max(a, b) + 1)
}

/** Clic (ou Maj+flèche, `shift`) sur une ligne en mode lignes. */
export function selectRow({ selected, displayed, anchor, target, shift = false, ctrl = false }: RowSelectInput): RowSelectResult {
  const range = shift ? rangeOf(displayed, anchor, target) : null
  if (range) return { selected: new Set(range), anchor }
  if (ctrl) {
    const next = new Set(selected)
    if (!next.delete(target)) next.add(target)
    return { selected: next, anchor: target }
  }
  if (selected.size > 1 && selected.has(target)) return { selected: null, anchor: target }
  if (selected.size === 1 && selected.has(target)) return { selected: null, anchor: target }
  return { selected: new Set([target]), anchor: target }
}

// ── Mode cases (GH33) ─────────────────────────────────────────────────────────

export interface ClickInput {
  selected: ReadonlySet<string>
  displayed: readonly string[]
  anchor: string | null
  target: string
  shift: boolean
}

export interface ClickResult {
  selected: Set<string>
  anchor: string | null
}

/** Clic sur une ligne (hors case) : bascule la ligne, le reste est inchangé ; avec Maj, la plage
 *  visible depuis l'ancre est ajoutée. GH198 — un clic ajoute à la sélection, il ne la remplace
 *  plus (Ctrl indifférent). */
export function checkboxRowClick({ selected, displayed, anchor, target, shift }: ClickInput): ClickResult {
  const next = new Set(selected)
  const range = shift ? rangeOf(displayed, anchor, target) : null
  if (range) {
    for (const id of range) next.add(id)
    return { selected: next, anchor }
  }
  if (next.has(target)) next.delete(target)
  else next.add(target)
  return { selected: next, anchor: target }
}

/** Clic sur la case d'une ligne : bascule sans toucher au reste ; avec Maj, l'état cible de la case
 *  cliquée s'applique à toute la plage affichée depuis l'ancre. */
export function checkboxClick({ selected, displayed, anchor, target, shift }: ClickInput): ClickResult {
  const check = !selected.has(target)
  const range = shift ? rangeOf(displayed, anchor, target) : null
  const next = new Set(selected)
  for (const id of range ?? [target]) {
    if (check) next.add(id)
    else next.delete(id)
  }
  return { selected: next, anchor: range ? anchor : target }
}

export type GroupState = 'all' | 'some' | 'none' | 'disabled'

/** État de la case d'un groupe (dossier ou en-tête) d'après ses identifiants éligibles. */
export function groupState(ids: readonly string[], selected: ReadonlySet<string>): GroupState {
  if (ids.length === 0) return 'disabled'
  const n = ids.reduce((acc, id) => acc + (selected.has(id) ? 1 : 0), 0)
  if (n === 0) return 'none'
  return n === ids.length ? 'all' : 'some'
}

/** Bascule d'un groupe : tous cochés → les décoche, sinon les coche tous. */
export function toggleGroup(ids: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected)
  if (groupState(ids, selected) === 'all') for (const id of ids) next.delete(id)
  else for (const id of ids) next.add(id)
  return next
}

export const ORPHAN_NODE_PREFIX = 'orphan:'

/** GH33 — arbre du sélecteur réduit aux items dont l'objectId est dans `keep` (dossiers conservés,
 *  même vides). Les objectIds de `keep` absents de l'arbre (objets créés hors UI) sont ajoutés en fin
 *  de racine, comme items synthétiques, pour rester sélectionnables. `titles` donne leur nom affiché. */
export function pruneTree(root: TypeTreeNode[], keep: ReadonlySet<string>, titles: ReadonlyMap<string, string>): TypeTreeNode[] {
  const seen = new Set<string>()
  function walk(nodes: TypeTreeNode[]): TypeTreeNode[] {
    const out: TypeTreeNode[] = []
    for (const n of nodes) {
      if (n.kind === 'folder') {
        out.push({ ...n, children: walk(n.children) })
      } else if (n.objectId && keep.has(n.objectId) && !seen.has(n.objectId)) {
        seen.add(n.objectId)
        out.push(n)
      }
    }
    return out
  }
  const pruned = walk(root)
  for (const id of keep) {
    if (seen.has(id)) continue
    pruned.push({ id: `${ORPHAN_NODE_PREFIX}${id}`, kind: 'item', name: titles.get(id) ?? id, objectId: id, children: [] })
  }
  return pruned
}
