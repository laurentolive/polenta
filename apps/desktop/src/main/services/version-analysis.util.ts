import type {
  ImpactNode, TestCampaign, VersionAnalysis, VersionImpactRoot, VersionImpactRow, VersionImpactSource,
  VersionImpactStep, VersionImpacted, VersionTestToRun, VersionTestsToRun,
} from '@polenta/types'
import { matchCoverageLink, type ImpactSnapshot } from './traceability.service'
import { repoKey } from './schema-refs.util'

// GH245 — analyse d'impact et tests à exécuter d'une version (specs/GH245.md §1–2), logique pure.
// Reprise de `change-analysis.util` / `change-tests.util` (@ 4e06052) adaptée à la version : racines =
// changements de la version et des versions de ses composants, lignes limitées au repo de la version,
// source (chemin) de chaque ligne.

type ElementType = 'requirement' | 'test_case'
type TreeBuilder = (id: string, type: ElementType) => { descendantTree: ImpactNode[]; ascendantTree: ImpactNode[] }

/** Statut d'impact qui écarte un élément des tests à exécuter (GH207 §10bis). */
const NO_IMPACT = 'pas_d_impact_reel'
const OPEN_CAMPAIGN = new Set(['planned', 'in_progress'])
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true })

export interface VersionAnalysisInput {
  /** Racines : éléments changés, avec le composant qui porte le changement. */
  roots: Array<{ id: string; component: string; viaIssues?: string[] }>
  snapshot: ImpactSnapshot
  trees: TreeBuilder
  /** Repo de la version : seules ses lignes sont retenues. */
  repoPath: string
  /** Éléments du composant (type déclaré par le schéma du repo) : un fichier d'un autre composant n'a pas de ligne. */
  ownIds: Set<string>
  impacted: VersionImpacted[]
  now?: Date
}

function elementOf(snapshot: ImpactSnapshot, id: string): { type: ElementType; title: string; repoPath: string } | null {
  const req = snapshot.requirements.get(id)
  if (req) return { type: 'requirement', title: req.title, repoPath: req.repoPath }
  const test = snapshot.tests.get(id)
  return test ? { type: 'test_case', title: test.title, repoPath: test.repoPath } : null
}

/** Parcours des arbres avec le chemin depuis la racine. */
function walk(nodes: ImpactNode[], trail: VersionImpactStep[], visit: (n: ImpactNode, path: VersionImpactStep[]) => void): void {
  for (const n of nodes) {
    const step: VersionImpactStep = { id: n.elementId, linkType: n.linkType, ...(n.parentIsTarget !== undefined && { parentIsTarget: n.parentIsTarget }) }
    const here = [...trail, step]
    visit(n, here)
    walk(n.children, here, visit)
  }
}

export function computeVersionAnalysis(input: VersionAnalysisInput): VersionAnalysis {
  const { snapshot, trees, repoPath, ownIds } = input
  const rootIds = new Set(input.roots.map(r => r.id))
  const roots: VersionImpactRoot[] = []
  for (const r of input.roots) {
    const el = elementOf(snapshot, r.id)
    if (!el) continue
    roots.push({ elementId: r.id, elementType: el.type, title: el.title, component: r.component, ...(r.viaIssues && { viaIssues: r.viaIssues }), ...trees(r.id, el.type) })
  }

  // Éléments atteints (hors racines) du repo de la version, avec toutes leurs sources ; `inTrees` :
  // tout nœud des arbres, quel que soit son repo (un statut saisi sur lui n'est pas « plus atteint »).
  const reached = new Map<string, { type: ElementType; title: string; sources: VersionImpactSource[] }>()
  const inTrees = new Set<string>(rootIds)
  for (const r of roots) {
    for (const tree of [r.descendantTree, r.ascendantTree]) {
      walk(tree, [], (n, trail) => {
        inTrees.add(n.elementId)
        if (rootIds.has(n.elementId)) return
        const el = elementOf(snapshot, n.elementId)
        if (!el || repoKey(el.repoPath) !== repoKey(repoPath) || !ownIds.has(n.elementId)) return
        const entry = reached.get(n.elementId) ?? { type: n.elementType, title: n.title, sources: [] }
        if (!entry.sources.some(s => s.rootId === r.elementId)) entry.sources.push({ rootId: r.elementId, path: trail })
        reached.set(n.elementId, entry)
      })
    }
  }

  const saved = new Map(input.impacted.map(i => [i.id, i]))
  const rows: VersionImpactRow[] = []
  for (const [id, el] of reached) {
    const s = saved.get(id)
    rows.push({ id, elementType: el.type, title: el.title, status: s?.status ?? 'impact_non_verifie', ...(s?.comment && { comment: s.comment }), reached: true, sources: el.sources })
  }
  for (const [id, s] of saved) {
    if (reached.has(id) || inTrees.has(id)) continue
    const el = elementOf(snapshot, id)
    rows.push({ id, elementType: el?.type ?? null, title: el?.title ?? null, status: s.status, ...(s.comment && { comment: s.comment }), reached: false, sources: [] })
  }
  rows.sort(byId)

  // Statut d'un élément reporté sur chacun de ses nœuds (GH199 Q1), y compris un nœud d'un autre repo
  // (statut saisi sur l'arbre, sans ligne).
  const rowById = new Map(rows.map(r => [r.id, r]))
  for (const r of roots) {
    for (const tree of [r.descendantTree, r.ascendantTree]) {
      walk(tree, [], n => {
        const row = rowById.get(n.elementId) ?? saved.get(n.elementId)
        if (row) { n.status = row.status; n.comment = row.comment ?? null }
      })
    }
  }

  return { computedAt: (input.now ?? new Date()).toISOString(), frozen: false, roots, rows }
}

/**
 * Tests à exécuter : racines et lignes atteintes, sauf `pas_d_impact_reel` (un test ainsi marqué n'est
 * jamais proposé) ; un test se propose lui-même, une exigence amène les tests qui la couvrent (instance
 * de cette exigence). `alreadyIn` : campagnes ouvertes du repo qui le contiennent (information).
 */
export function computeVersionTests(
  rootIds: string[], rows: VersionImpactRow[], snapshot: ImpactSnapshot, campaigns: TestCampaign[], repoPath: string, ownIds: Set<string>,
): VersionTestsToRun {
  const rootSet = new Set(rootIds)
  // Un élément changé (racine) reste proposé même si un statut « pas d'impact » lui reste attaché.
  const excluded = new Set(rows.filter(r => r.status === NO_IMPACT && !rootSet.has(r.id)).map(r => r.id))
  const sources = [...new Set([...rootIds, ...rows.filter(r => r.reached && r.status !== NO_IMPACT).map(r => r.id)])]
  // Tests du composant : une campagne (raccourcis) ne reçoit que les tests de son repo ; un composant
  // propose les siens dans sa propre version.
  const testIds = new Set([...snapshot.tests].filter(([id, t]) => repoKey(t.repoPath) === repoKey(repoPath) && ownIds.has(id)).map(([id]) => id))
  const reqIds = new Set(snapshot.requirements.keys())
  const byTest = new Map<string, { requirementIds: Set<string>; sources: Set<string>; whole: boolean }>()
  const entry = (id: string) => {
    if (!byTest.has(id)) byTest.set(id, { requirementIds: new Set(), sources: new Set(), whole: false })
    return byTest.get(id)!
  }
  // Couverture des exigences sources en une passe sur les liens (lien de couverture, sens indifférent).
  // GH269 — couverture jugée sur tous les tests du workspace : une exigence de composant couverte par
  // un test de son composant n'est pas « non couverte » dans la version produit. Seuls les tests du
  // repo sont proposés.
  const reqSources = new Set(sources.filter(s => reqIds.has(s)))
  const allTestIds = new Set(snapshot.tests.keys())
  const coveringByReq = new Map<string, string[]>()
  for (const link of snapshot.links) {
    const m = matchCoverageLink(link, allTestIds, reqSources)
    if (m) coveringByReq.set(m.reqId, [...(coveringByReq.get(m.reqId) ?? []), m.testId])
  }
  const uncovered: string[] = []
  for (const source of sources) {
    if (testIds.has(source)) {
      // Test changé : en entier. Test seulement atteint : ses instances viennent des exigences qui
      // l'amènent ; en entier s'il n'en a aucune (fin de boucle).
      const e = entry(source)
      if (rootSet.has(source)) e.whole = true
      e.sources.add(source)
      continue
    }
    if (!reqSources.has(source)) continue
    const covering = coveringByReq.get(source) ?? []
    if (covering.length === 0) uncovered.push(source)
    for (const testId of covering) {
      if (!testIds.has(testId)) continue
      const e = entry(testId)
      e.requirementIds.add(source)
      e.sources.add(source)
    }
  }
  const open = campaigns.filter(c => OPEN_CAMPAIGN.has(c.status))
  const tests: VersionTestToRun[] = [...byTest]
    .filter(([testId]) => !excluded.has(testId))
    .map(([testId, e]) => {
      const requirementIds = e.whole || e.requirementIds.size === 0 ? [] : [...e.requirementIds].sort()
      // Une entrée d'instance ne compte que pour l'exigence voulue ; une entrée du test entier, pour toutes.
      const covers = (run: { testCaseId: string; requirementId?: string }) => run.testCaseId === testId
        && (requirementIds.length === 0 || !run.requirementId || requirementIds.includes(run.requirementId))
      return {
        testId,
        title: snapshot.tests.get(testId)?.title ?? '',
        requirementIds,
        sources: [...e.sources].sort(),
        alreadyIn: open.filter(c => c.runs.some(covers)).map(c => ({ id: c.id, title: c.title })),
      }
    })
    .sort((a, b) => a.testId.localeCompare(b.testId, undefined, { numeric: true }))
  return { tests, uncovered: uncovered.sort() }
}
