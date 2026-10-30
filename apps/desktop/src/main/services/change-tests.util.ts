import type { Change, ChangeImpactRow, ChangeTestToRun, LinkedCampaign, TestCampaign } from '@polenta/types'
import { matchCoverageLink, type ImpactSnapshot } from './traceability.service'

/** GH207 — statuts d'impact qui demandent une exécution. */
const TO_RUN_STATUSES = new Set(['impact_a_tester', 'modification_a_tester'])
/** Campagne qui peut encore recevoir des entrées. */
const OPEN_CAMPAIGN = new Set(['planned', 'in_progress'])

/**
 * GH207 §1 — tests à exécuter d'un changeset : éléments à modifier (Q1) et impactés « à tester ».
 * Un test vient lui-même ; une exigence amène les tests qui la couvrent (lien de couverture dans un
 * sens ou l'autre), avec son instance (T179). Exigence sans test : `uncovered`.
 */
export function computeTestsToRun(change: Change, rows: ChangeImpactRow[], snapshot: ImpactSnapshot): { tests: ChangeTestToRun[]; uncovered: string[] } {
  const sources = [
    ...change.toModify.map(t => t.id),
    ...rows.filter(r => TO_RUN_STATUSES.has(r.status)).map(r => r.id),
  ]
  const testIds = new Set(snapshot.tests.keys())
  const reqIds = new Set(snapshot.requirements.keys())
  const byTest = new Map<string, { requirementIds: Set<string>; sources: Set<string>; whole: boolean }>()
  const entry = (id: string) => {
    if (!byTest.has(id)) byTest.set(id, { requirementIds: new Set(), sources: new Set(), whole: false })
    return byTest.get(id)!
  }
  const uncovered: string[] = []
  for (const source of [...new Set(sources)]) {
    if (testIds.has(source)) {
      const e = entry(source)
      e.whole = true
      e.sources.add(source)
      continue
    }
    if (!reqIds.has(source)) continue
    const covering = snapshot.links
      .map(link => matchCoverageLink(link, testIds, new Set([source])))
      .filter((m): m is { testId: string; reqId: string } => !!m)
    if (covering.length === 0) uncovered.push(source)
    for (const { testId } of covering) {
      const e = entry(testId)
      e.requirementIds.add(source)
      e.sources.add(source)
    }
  }
  const tests = [...byTest].map(([testId, e]) => ({
    testId,
    requirementIds: e.whole ? [] : [...e.requirementIds].sort(),
    sources: [...e.sources].sort(),
  })).sort((a, b) => a.testId.localeCompare(b.testId, undefined, { numeric: true }))
  return { tests, uncovered: uncovered.sort() }
}

/** GH207 §4 — campagnes liées (`campaigns` du changeset) et tests à ajouter (§3). */
export function linkedCampaigns(change: Change, tests: ChangeTestToRun[], campaigns: TestCampaign[]): { linked: LinkedCampaign[]; toAdd: string[] } {
  const byId = new Map(campaigns.map(c => [c.id, c]))
  const toRun = new Set(tests.map(t => t.testId))
  const covered = new Set<string>()
  const linked = change.campaigns.map((id): LinkedCampaign => {
    const c = byId.get(id)
    if (!c) return { id, title: '', status: '', passed: 0, total: 0, changesetTests: 0, missing: true }
    if (OPEN_CAMPAIGN.has(c.status)) for (const r of c.runs) covered.add(r.testCaseId)
    return {
      id, title: c.title, status: c.status,
      passed: c.runs.filter(r => r.status === 'PASS').length,
      total: c.runs.length,
      changesetTests: c.runs.filter(r => toRun.has(r.testCaseId)).length,
      missing: false,
    }
  })
  return { linked, toAdd: tests.map(t => t.testId).filter(id => !covered.has(id)) }
}
