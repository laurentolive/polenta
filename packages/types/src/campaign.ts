import type { TestCase } from './test'

export type CampaignStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned'
export type TestRunStatus = 'pending' | 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'

export interface TestCampaign {
  id: string           // CAMP-0001
  title: string
  objectTypeRef?: string
  fields: Record<string, unknown>
  baselineRef?: string
  component?: string
  level?: string
  status: CampaignStatus
  testCaseIds: string[]
  runs: CampaignTestRun[]
  createdAt: string
  completedAt?: string | null
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
  /** T171 — tag git auquel les paramètres ont été lus (= `baselineRef` de la campagne) ; absent :
   *  état courant. */
  paramSourceRef?: string
  /** T171 — références de base restées non résolues à l'ajout, avec leur raison. */
  unresolvedParams?: UnresolvedParam[]
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
  /** Tag de lecture (baselineRef) ou absent pour l'état courant. */
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
  baselineRef?: string
  component?: string
  level?: string
  testCaseIds: string[]
  paramValuesByTest?: Record<string, Record<string, string>>
  /** T179 — exigences retenues par test itérant (voir `ReqInstanceSelection`). */
  reqInstances?: ReqInstanceSelection
}

export interface UpdateCampaignDto {
  title?: string
  objectTypeRef?: string
  fields?: Record<string, unknown>
}
