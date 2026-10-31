import type { ObjectHistory } from './history'
import type { TestCase } from './test'

export type CampaignStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned'
export type TestRunStatus = 'pending' | 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'

/** GH69 — gravité décroissante : le statut le plus grave d'un groupe d'entrées l'emporte. GH74 :
 *  partagée par la page campagne, le graphe de données (`schema.entryStatuses[].severity`) et la
 *  bibliothèque projet (`lib/status.js`). */
export const RUN_STATUS_SEVERITY: Record<TestRunStatus, number> = {
  FAIL: 4,
  BLOCKED: 3,
  INCOMPLETE: 2,
  pending: 1,
  PASS: 0,
}

/** GH74 — ordre d'affichage canonique des statuts d'entrée (attente, puis résultats). */
export const RUN_STATUS_ORDER: readonly TestRunStatus[] = ['pending', 'INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS']

export interface TestCampaign {
  id: string           // CAMP-0001
  title: string
  objectTypeRef?: string
  fields: Record<string, unknown>
  component?: string
  level?: string
  status: CampaignStatus
  testCaseIds: string[]
  runs: CampaignTestRun[]
  /** GH73 — entrées retirées (`removeEntries`), conservées avec `removedAt` : un historique daté
   *  reste juste après un retrait. Absent si aucune. Les lecteurs de `runs` ne les voient pas. */
  removedRuns?: RemovedCampaignTestRun[]
  createdAt: string
  completedAt?: string | null
  /** GH77 — historique du statut et des champs personnalisés suivis. */
  history?: ObjectHistory
}

export interface CampaignTestRun {
  /** Identifiant unique de cette inclusion du test dans la campagne (ex. `TEST-0042-2`
   *  pour la 2e instance de TEST-0042) — distinct de `testCaseId` car un même test peut
   *  être inclus plusieurs fois s'il a des paramètres (T97 sprint 2). */
  entryId: string
  testCaseId: string
  /** T179 — exigence pour laquelle l'instance a été générée (test contenant des `{req.<champ>}`,
   *  une instance par exigence liée). Absent : test sans `{req.…}`, ou sans exigence liée. */
  requirementId?: string
  /** Copie complète du `TestCase` au moment de l'inclusion dans la campagne (T49) — fige
   *  contenu/statut, indépendamment des modifications ultérieures de la source. Absent sur
   *  les entrées créées avant T49 (pas de backfill rétroactif, décision de cadrage) : ces
   *  entrées continuent de se résoudre contre l'état live du test. */
  testSnapshot?: TestCase
  status: TestRunStatus
  /** GH73 — instant d'ajout de l'entrée dans la campagne. Absent : entrée antérieure à GH73. */
  addedAt?: string
  runId?: string
  executedAt?: string
  executedBy?: string
  /** Paramètres T97 **saisis à la main** (références locales absentes de la base, T171 §6),
   *  modifiables après l'ajout. Une référence ne figure jamais à la fois ici et dans
   *  `resolvedParams`. */
  paramValues?: Record<string, string>
  /** T171 — valeurs lues dans la base de paramètres et figées à l'ajout (clé = référence telle
   *  qu'écrite : `nom` ou `<nœud>::nom`, valeur déjà formatée `value unit`). Jamais modifiées. */
  resolvedParams?: Record<string, string>
  /** T171 — tag git auquel les paramètres ont été lus (ancien `baselineRef` de la campagne, retiré
   *  par GH243 : plus écrit) ; absent : état courant. */
  paramSourceRef?: string
  /** T171 — références de base restées non résolues à l'ajout, avec leur raison. */
  unresolvedParams?: UnresolvedParam[]
  /** GH64 — instance reportée depuis une autre campagne (entrée source). Absent : ajout normal. */
  carriedFrom?: CarriedFrom
}

/** GH73 — entrée retirée d'une campagne (`TestCampaign.removedRuns`), avec l'instant du retrait. */
export type RemovedCampaignTestRun = CampaignTestRun & { removedAt: string }

/** GH73 — référence à une entrée de campagne (campagne + instance). */
export interface CampaignEntryRef {
  campaignId: string
  entryId: string
}

/** GH64 — entrée d'une autre campagne dont une instance a été reportée. */
export type CarriedFrom = CampaignEntryRef

/** GH64 — entrée source retenue pour un report, avec les saisies de l'étape 2 du sélecteur. */
export interface CarriedEntrySelection extends CarriedFrom {
  /** Valeurs saisies à la main (pré-remplies depuis l'entrée source, éditables). */
  paramValues?: Record<string, string>
  /** Entrée source sans exigence d'un test devenu itérant (T179) : exigences retenues, une instance
   *  chacune. Absent : toutes les exigences liées. Ignoré pour une entrée qui a une exigence. */
  reqInstances?: Array<{ requirementId: string; paramValues?: Record<string, string> }>
}

/**
 * GH64 — clé de doublon d'une instance de campagne : (test, exigence, valeurs saisies à la main).
 * Valeurs normalisées (clés triées, `trim()`, vides retirées) : un test sans référence à saisir se
 * réduit à (test, exigence), soit la règle « une seule inclusion d'un test sans paramètre ».
 */
export function carryKey(
  testCaseId: string,
  requirementId: string | undefined,
  paramValues: Record<string, string> | undefined,
): string {
  const values = Object.entries(paramValues ?? {})
    .map(([k, v]) => [k, (v ?? '').trim()] as const)
    .filter(([, v]) => v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([testCaseId, requirementId ?? '', values])
}

export type UnresolvedParamReason = 'tag_not_found' | 'missing' | 'empty' | 'unknown_node' | 'no_linked_requirement'

export interface UnresolvedParam {
  ref: string
  reason: UnresolvedParamReason
}

/** T171 — résolution prévisionnelle des paramètres d'un test à l'ajout en campagne (sans écriture). */
export interface ParamResolutionPreview {
  testCaseId: string
  /** Références lues dans la base (valeur formatée). */
  resolved: Record<string, string>
  /** Références locales absentes de la base : à saisir à la main (ordre T97). */
  manual: string[]
  unresolved: UnresolvedParam[]
  /** Tag de lecture, ou absent pour l'état courant (les campagnes lisent l'état courant, GH243). */
  sourceRef?: string
  /** T179 — présent si le test contient au moins une `{req.<champ>}` : une entrée par exigence liée
   *  (lien de couverture, non terminale, tri naturel des IDs) ; vide si aucune (les clés `req.*` sont
   *  alors dans `unresolved`). Les clés `req.*` ne sont jamais dans `resolved` ni `manual`. */
  requirements?: ReqInstancePreview[]
}

/** T179 — valeurs `{req.<champ>}` d'une exigence liée, pour l'instance qui lui serait dédiée. */
export interface ReqInstancePreview {
  requirementId: string
  title: string
  /** Clés `req.<champ>`, valeurs formatées (paramètres de base imbriqués déjà substitués). */
  resolved: Record<string, string>
  unresolved: UnresolvedParam[]
}

/** T179 — par test itérant (`{req.…}`) : exigences retenues à l'ajout, et valeurs saisies à la main
 *  propres à chaque instance. Test absent : toutes ses exigences liées, avec `paramValuesByTest`. */
export type ReqInstanceSelection = Record<string, Array<{ requirementId: string; paramValues?: Record<string, string> }>>

export interface CreateCampaignDto {
  title: string
  objectTypeRef?: string
  fields?: Record<string, unknown>
  component?: string
  level?: string
  testCaseIds: string[]
  paramValuesByTest?: Record<string, Record<string, string>>
  /** T179 — exigences retenues par test itérant (voir `ReqInstanceSelection`). */
  reqInstances?: ReqInstanceSelection
  /** GH64 — entrées reportées depuis d'autres campagnes. */
  carried?: CarriedEntrySelection[]
}

export interface UpdateCampaignDto {
  title?: string
  objectTypeRef?: string
  fields?: Record<string, unknown>
}
