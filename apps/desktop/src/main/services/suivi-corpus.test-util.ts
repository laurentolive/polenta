import type { PolentaGraph } from '@polenta/types'

// GH74 — jeux de données du corpus de non-régression de la vue Suivi (specs/GH74.md §12).

/**
 * Jeu synthétique de la taille ×50 de #78 : 250 campagnes, 1 250 entrées, ~2 000 exécutions sur
 * 200 jours. Pseudo-aléatoire à graine fixe : toujours le même graphe.
 */
export function inflatedGraphJson(): string {
  let seed = 42
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const day = (d: number, h = 10) => new Date(Date.UTC(2026, 3, 1) + d * 86_400_000 + h * 3_600_000).toISOString().replace('.000Z', 'Z')
  const results = ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE'] as const
  const campaigns: PolentaGraph['campaigns'] = []
  const runs: PolentaGraph['runs'] = []
  for (let c = 0; c < 250; c++) {
    const start = Math.floor(rnd() * 150)
    const id = `CAMP-${String(c).padStart(4, '0')}`
    const entries = Array.from({ length: 5 }, (_, i) => {
      const entryId = `T-${c}-${i}`
      const n = Math.floor(rnd() * 3)
      let last: string | null = null
      let status: 'pending' | (typeof results)[number] = 'pending'
      for (let k = 0; k < n; k++) {
        last = day(start + 1 + Math.floor(rnd() * 40))
        status = results[Math.floor(rnd() * 4)]
        runs.push({ id: `R-${c}-${i}-${k}`, repo: 'r', testCaseId: `T-${i}`, campaignEntry: { campaignId: id, entryId }, requirementId: null, result: status, executedAt: last, executedBy: 'x', duration: 0, origin: null, fields: {}, notes: '', stepResults: [] })
      }
      return { entryId, testCaseId: `T-${i}`, requirementId: null, status, addedAt: day(start), runId: null, executedAt: last, executedBy: null, carriedFrom: null, snapshot: null, resyncable: false }
    })
    campaigns.push({ id, repo: 'r', component: 'r', objectTypeRef: null, title: id, status: 'in_progress', fields: {}, history: {}, baselineRef: null, targetComponent: null, changeset: null, level: null, createdAt: day(start, 8), completedAt: null, entries, removedEntries: [] })
  }
  return JSON.stringify({
    schema: { objectTypes: [], linkTypes: [], campaignStatuses: [], entryStatuses: ['pending', 'INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS'].map((name, order) => ({ name, label: name, order })) },
    campaigns, runs, requirements: [], tests: [], links: [],
  })
}
