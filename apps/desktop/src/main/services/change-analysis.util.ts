import type {
  Change, ChangeAnalysis, ChangeAnalysisRoot, ChangeImpactRow, ImpactNode, TestCampaign,
} from '@polenta/types'
import type { ImpactSnapshot } from './traceability.service'

// GH199 — analyse d'impact d'un change (specs/GH199.md §1–4), logique pure : racines, arbres,
// lignes des impactés (un statut par élément), campagnes en cours concernées.

type ElementType = 'requirement' | 'test_case'
type TreeBuilder = (id: string, type: ElementType) => { descendantTree: ImpactNode[]; ascendantTree: ImpactNode[] }

const CLOSED_CAMPAIGN = new Set(['completed', 'abandoned'])

export interface ChangeAnalysisInput {
  change: Change
  snapshot: ImpactSnapshot
  trees: TreeBuilder
  campaigns: TestCampaign[]
  /** Exigence du composant concerné (racines quand les listes sont vides). */
  isComponentRequirement: (objectTypeRef: string | undefined) => boolean
  snapshotKind: ChangeAnalysis['snapshot']
  now?: Date
}

function elementOf(snapshot: ImpactSnapshot, id: string): { type: ElementType; title: string } | null {
  const req = snapshot.requirements.get(id)
  if (req) return { type: 'requirement', title: req.title }
  const test = snapshot.tests.get(id)
  return test ? { type: 'test_case', title: test.title } : null
}

function walk(nodes: ImpactNode[], visit: (n: ImpactNode) => void): void {
  for (const n of nodes) {
    visit(n)
    walk(n.children, visit)
  }
}

export function computeChangeAnalysis(input: ChangeAnalysisInput): ChangeAnalysis {
  const { change, snapshot, trees, campaigns } = input
  const declared = change.impacted.filter(i => i.source === 'declared')
  const persistedComputed = new Map(change.impacted.filter(i => i.source === 'computed').map(i => [i.id, i]))

  // Racines : à modifier + impactés déclarés ; listes vides → exigences du composant.
  let rootIds = [...new Set([...change.toModify.map(t => t.id), ...declared.map(i => i.id)])]
  if (rootIds.length === 0) {
    rootIds = [...snapshot.requirements.entries()]
      .filter(([, r]) => input.isComponentRequirement(r.objectTypeRef))
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }
  const rootSet = new Set(rootIds)

  const roots: ChangeAnalysisRoot[] = rootIds.map(id => {
    const el = elementOf(snapshot, id)
    if (!el) return { elementId: id, elementType: 'requirement', title: id, descendantTree: [], ascendantTree: [] }
    return { elementId: id, elementType: el.type, title: el.title, ...trees(id, el.type) }
  })

  // Éléments atteints (hors racines), dédupliqués sur toutes les racines.
  const reached = new Map<string, { type: ElementType; title: string }>()
  for (const r of roots) {
    for (const tree of [r.descendantTree, r.ascendantTree]) {
      walk(tree, n => { if (!rootSet.has(n.elementId) && !reached.has(n.elementId)) reached.set(n.elementId, { type: n.elementType, title: n.title }) })
    }
  }

  const rows: ChangeImpactRow[] = []
  const declaredIds = new Set(declared.map(i => i.id))
  for (const d of declared) {
    const el = elementOf(snapshot, d.id)
    rows.push({ id: d.id, elementType: el?.type ?? null, title: el?.title ?? null, status: d.status, ...(d.comment && { comment: d.comment }), source: 'declared', reached: true })
  }
  for (const [id, el] of reached) {
    if (declaredIds.has(id)) continue
    const saved = persistedComputed.get(id)
    rows.push({ id, elementType: el.type, title: el.title, status: saved?.status ?? 'impact_non_verifie', ...(saved?.comment && { comment: saved.comment }), source: 'computed', reached: true })
  }
  for (const [id, saved] of persistedComputed) {
    if (reached.has(id) || declaredIds.has(id)) continue
    const el = elementOf(snapshot, id)
    rows.push({ id, elementType: el?.type ?? null, title: el?.title ?? null, status: saved.status, ...(saved.comment && { comment: saved.comment }), source: 'computed', reached: false })
  }

  // Statut d'un élément reporté sur chacun de ses nœuds (Q1).
  const rowById = new Map(rows.map(r => [r.id, r]))
  for (const r of roots) {
    for (const tree of [r.descendantTree, r.ascendantTree]) {
      walk(tree, n => {
        const row = rowById.get(n.elementId)
        if (row) { n.status = row.status; n.comment = row.comment ?? null }
      })
    }
  }

  // Campagnes non closes contenant un test racine, déclaré ou atteint.
  const testIds = new Set<string>()
  for (const r of roots) if (r.elementType === 'test_case' && snapshot.tests.has(r.elementId)) testIds.add(r.elementId)
  for (const row of rows) if (row.elementType === 'test_case' && row.reached) testIds.add(row.id)
  const concerned = campaigns
    .filter(c => !CLOSED_CAMPAIGN.has(c.status))
    .map(c => ({ id: c.id, title: c.title, status: c.status, testIds: [...new Set(c.runs.map(run => run.testCaseId).filter(id => testIds.has(id)))] }))
    .filter(c => c.testIds.length > 0)

  return {
    computedAt: (input.now ?? new Date()).toISOString(),
    frozen: false,
    snapshot: input.snapshotKind,
    roots,
    rows,
    campaigns: concerned,
  }
}
