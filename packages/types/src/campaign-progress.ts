import type { CampaignTestRun } from './campaign'
import type { ProjectSchema } from './schema'
import { flattenSystemNodes } from './schema-tree'
import type { TestCase } from './test'

// GH71 — étape d'avancement d'une entrée de campagne, de la définition du test au résultat :
// `prep:<statut>` (test pas encore approuvé), `ready` (approuvé, non exécuté), puis le résultat.
// Règle partagée par le main (table `campaign_entries`, ouverture d'une ligne) et le renderer
// (pastilles de la page campagne, préréglage du widget barre). Cf. specs/GH71.md §1.

export const PREP_PREFIX = 'prep:'
export const PROGRESS_READY = 'ready'
/** Résultats d'exécution, dans l'ordre canonique (après `ready`). */
export const PROGRESS_RESULTS = ['INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS'] as const

export const prepKey = (status: string): string => PREP_PREFIX + status

/** Statut de test d'une clé `prep:<statut>`, sinon `null`. */
export function prepStatusOf(key: string): string | null {
  return key.startsWith(PREP_PREFIX) && key.length > PREP_PREFIX.length ? key.slice(PREP_PREFIX.length) : null
}

export function isProgressKey(v: unknown): v is string {
  if (typeof v !== 'string') return false
  return prepStatusOf(v) !== null || v === PROGRESS_READY || (PROGRESS_RESULTS as readonly string[]).includes(v)
}

/**
 * Test dont on juge la préparation d'une entrée (règle GH68) : l'état live tant que l'instance est
 * resynchronisable — campagne ouverte, entrée `pending`, copie présente et non approuvée — sinon la
 * copie figée, à défaut le test live (entrée pré-T49).
 */
export function progressSubject(
  run: CampaignTestRun,
  live: TestCase | undefined,
  campaignOpen: boolean,
  isApproved: (test: TestCase) => boolean,
): TestCase | undefined {
  const resyncable = campaignOpen && run.status === 'pending' && !!run.testSnapshot && !isApproved(run.testSnapshot)
  return resyncable ? live ?? run.testSnapshot : run.testSnapshot ?? live
}

/** Étape d'une entrée. Entrée non exécutée sur un test inconnu → `ready` (rien à dire de sa préparation). */
export function entryProgress(
  run: CampaignTestRun,
  subject: TestCase | undefined,
  isApproved: (test: TestCase) => boolean,
): string {
  if (run.status !== 'pending') return run.status
  if (!subject || isApproved(subject)) return PROGRESS_READY
  return prepKey(subject.status)
}

const PREP_UNKNOWN_RANK = 999
const READY_RANK = 1000
const OTHER_RANK = 2000

/** Rang canonique d'une étape. `statusIndex` : position du statut dans son type (préparation). */
export function progressRank(key: string, statusIndex?: number): number {
  if (prepStatusOf(key) !== null) return statusIndex !== undefined && statusIndex >= 0 ? statusIndex : PREP_UNKNOWN_RANK
  if (key === PROGRESS_READY) return READY_RANK
  const result = (PROGRESS_RESULTS as readonly string[]).indexOf(key)
  return result === -1 ? OTHER_RANK : READY_RANK + 1 + result
}

/** Rang des statuts de préparation d'un schéma : nom → plus petite position dans un type de test
 *  (tous nœuds, toute profondeur). Un nom présent dans plusieurs types est une seule étape. */
export function prepStatusOrder(schema: ProjectSchema | undefined): Map<string, number> {
  const order = new Map<string, number>()
  for (const { node } of flattenSystemNodes(schema?.nodes ?? [])) {
    for (const type of node.objectTypes ?? []) {
      if (type.category !== 'test') continue
      ;(type.statuses ?? []).forEach((s, i) => {
        const known = order.get(s.name)
        if (known === undefined || i < known) order.set(s.name, i)
      })
    }
  }
  return order
}

/** Comparateur de clés d'étape dans l'ordre canonique, à égalité de rang par ordre alphabétique. */
export function compareProgressKeys(order: Map<string, number>): (a: string, b: string) => number {
  const rank = (k: string) => {
    const status = prepStatusOf(k)
    return progressRank(k, status !== null ? order.get(status) : undefined)
  }
  return (a, b) => rank(a) - rank(b) || a.localeCompare(b)
}
