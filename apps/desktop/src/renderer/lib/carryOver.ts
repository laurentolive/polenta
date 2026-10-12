import { carryKey } from '@polenta/types'
import type {
  CampaignTestRun, CarriedEntrySelection, ParamResolutionPreview, TestCampaign, TestCase, TestRunStatus,
} from '@polenta/types'
import { effectiveReqSelection, isIteratingPreview, type ReqSelectionState } from './reqInstances'

// GH64 — report d'entrées d'une campagne à l'autre : onglet « Depuis une campagne » du sélecteur de
// tests. Logique pure (sans React) : lignes proposées, disponibilité, doublons, sélection envoyée au
// main. Les saisies de l'étape 2 sont indexées par la clé de ligne (`CarryRow.key`).

/** Ordre d'affichage des statuts d'entrée dans le filtre. */
export const CARRY_STATUSES: TestRunStatus[] = ['pending', 'BLOCKED', 'INCOMPLETE', 'FAIL', 'PASS']
/** Statuts cochés par défaut : ce qui n'a pas abouti, hors échec franc. */
export const DEFAULT_CARRY_STATUSES: TestRunStatus[] = ['pending', 'BLOCKED', 'INCOMPLETE']

export type CarryEligibility = 'ok' | 'notApproved' | 'outOfScope'
export type CarryUnavailable = 'deleted' | 'notApproved' | 'outOfScope' | 'reqUnlinked' | 'alreadyPresent'

export interface CarryRow {
  /** Clé de doublon (test, exigence, valeurs saisies de la source). */
  key: string
  /** Entrée source retenue : la plus récente des campagnes ayant la même clé. */
  campaignId: string
  entryId: string
  /** Autres campagnes source ayant une entrée de même clé. */
  otherSources: string[]
  testCaseId: string
  requirementId?: string
  /** Valeurs saisies à la main de l'entrée source. */
  paramValues: Record<string, string>
  status: TestRunStatus
  executedAt?: string
  executedBy?: string
  /** `testSnapshot.version` de la source (absent : entrée pré-T49). */
  sourceVersion?: number
  /** Version actuelle du test (absent : test supprimé). */
  liveVersion?: number
  unavailable?: CarryUnavailable
}

/** Entrée reportée retenue, telle que remontée par le sélecteur (le main ne reçoit que la partie
 *  `CarriedEntrySelection`, cf. `toCarriedSelection`). */
export interface PickedCarry extends CarriedEntrySelection {
  testCaseId: string
  requirementId?: string
}

/** État du report dans le sélecteur, conservé pour sa réouverture (formulaire de création). */
export interface CarryState {
  sources: string[]
  statuses: TestRunStatus[]
  /** Clés cochées. */
  checked: string[]
  /** Clés déjà apparues (une ligne n'est cochée par défaut qu'à sa première apparition). */
  seen: string[]
  /** Saisies de l'étape 2 par clé de ligne. */
  values: Record<string, Record<string, string>>
  /** Exigences retenues par clé de ligne (entrée sans exigence d'un test devenu itérant). */
  reqSel: ReqSelectionState
}

export const EMPTY_CARRY_STATE: CarryState = {
  sources: [], statuses: DEFAULT_CARRY_STATUSES, checked: [], seen: [], values: {}, reqSel: {},
}

export function runKey(r: Pick<CampaignTestRun, 'testCaseId' | 'requirementId' | 'paramValues'>): string {
  return carryKey(r.testCaseId, r.requirementId, r.paramValues)
}

/** Clés des instances d'une campagne cible (vide à la création). */
export function targetKeysOf(runs: CampaignTestRun[] | undefined): Set<string> {
  return new Set((runs ?? []).map(runKey))
}

/** Campagnes proposées comme source : toutes sauf la cible, plus récente d'abord. */
export function sourceCampaigns(campaigns: TestCampaign[], targetId: string | undefined): TestCampaign[] {
  return campaigns
    .filter(c => c.id !== targetId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

/**
 * Lignes de l'onglet : entrées des campagnes `sources` dont le statut est dans `statuses`, une par
 * clé (la plus récente : `executedAt`, à défaut création de sa campagne), dans l'ordre des
 * campagnes (plus récente d'abord) puis des entrées. `previews` : résolution à la baseline cible
 * (exigences encore liées) — tant qu'elle manque pour un test, son exigence est supposée liée.
 */
export function buildCarryRows(input: {
  sources: TestCampaign[]
  statuses: Iterable<TestRunStatus>
  testsById: Map<string, TestCase>
  isEligible: (tc: TestCase) => CarryEligibility
  previews: Map<string, ParamResolutionPreview>
  targetKeys: Set<string>
}): CarryRow[] {
  const statuses = new Set(input.statuses)
  const campaigns = [...input.sources].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const best = new Map<string, { campaign: TestCampaign; run: CampaignTestRun; order: number; recency: string }>()
  const others = new Map<string, Set<string>>()
  let order = 0
  for (const campaign of campaigns) {
    for (const run of campaign.runs) {
      if (!statuses.has(run.status)) continue
      const key = runKey(run)
      const recency = run.executedAt ?? campaign.createdAt
      const current = best.get(key)
      const ids = others.get(key) ?? new Set<string>()
      others.set(key, ids)
      ids.add(campaign.id)
      if (!current || recency > current.recency) best.set(key, { campaign, run, order: current?.order ?? order, recency })
      order++
    }
  }

  return [...best.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([key, { campaign, run }]) => {
      const tc = input.testsById.get(run.testCaseId)
      const row: CarryRow = {
        key,
        campaignId: campaign.id,
        entryId: run.entryId,
        otherSources: [...others.get(key)!].filter(id => id !== campaign.id),
        testCaseId: run.testCaseId,
        ...(run.requirementId && { requirementId: run.requirementId }),
        paramValues: run.paramValues ?? {},
        status: run.status,
        ...(run.executedAt && { executedAt: run.executedAt }),
        ...(run.executedBy && { executedBy: run.executedBy }),
        ...(run.testSnapshot?.version !== undefined && { sourceVersion: run.testSnapshot.version }),
        ...(tc && { liveVersion: tc.version }),
      }
      const unavailable = unavailability(row, tc, input)
      if (unavailable) row.unavailable = unavailable
      return row
    })
}

function unavailability(
  row: CarryRow,
  tc: TestCase | undefined,
  input: { isEligible: (tc: TestCase) => CarryEligibility; previews: Map<string, ParamResolutionPreview>; targetKeys: Set<string> },
): CarryUnavailable | undefined {
  if (!tc) return 'deleted'
  const eligibility = input.isEligible(tc)
  if (eligibility !== 'ok') return eligibility
  const preview = input.previews.get(row.testCaseId)
  if (row.requirementId && isIteratingPreview(preview)
    && !preview!.requirements!.some(r => r.requirementId === row.requirementId)) return 'reqUnlinked'
  if (input.targetKeys.has(row.key)) return 'alreadyPresent'
  return undefined
}

/** Test modifié depuis l'entrée source (avertissement, sans effet sur la disponibilité). */
export function versionChanged(row: CarryRow): boolean {
  return row.sourceVersion !== undefined && row.liveVersion !== undefined && row.sourceVersion !== row.liveVersion
}

/** Entrée sans exigence d'un test devenu itérant : exigences à choisir à l'étape 2. */
export function picksRequirements(row: CarryRow, preview: ParamResolutionPreview | undefined): boolean {
  return !row.requirementId && isIteratingPreview(preview)
}

/** Valeurs de départ de l'étape 2 : celles de la source, limitées aux références à saisir. */
export function initialCarryValues(row: CarryRow, preview: ParamResolutionPreview | undefined): Record<string, string> {
  if (!preview) return { ...row.paramValues }
  return Object.fromEntries(preview.manual.map(k => [k, row.paramValues[k] ?? '']))
}

/** Saisies de l'étape 2 d'une ligne (pré-remplies tant que la ligne n'a pas été éditée). */
export function carryValuesOf(
  row: CarryRow,
  preview: ParamResolutionPreview | undefined,
  values: Record<string, Record<string, string>>,
): Record<string, string> {
  return values[row.key] ?? initialCarryValues(row, preview)
}

/** La ligne demande une saisie à l'étape 2. */
export function carryNeedsInput(row: CarryRow, preview: ParamResolutionPreview | undefined): boolean {
  return (preview?.manual.length ?? 0) > 0 || picksRequirements(row, preview)
}

/**
 * Exigences déjà prises par les lignes reportées qui en ont une, par test : une entrée sans
 * exigence d'un test devenu itérant ne les propose pas une seconde fois.
 */
export function carriedReqIds(rows: CarryRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.requirementId) continue
    const set = out.get(row.testCaseId) ?? new Set<string>()
    set.add(row.requirementId)
    out.set(row.testCaseId, set)
  }
  return out
}

/** Entrées retenues, avec leurs saisies de l'étape 2. Une entrée sans exigence d'un test devenu
 *  itérant dont aucune exigence n'est retenue ne crée rien : elle est omise. `presentOf` : exigences
 *  déjà présentes dans la cible (et prises par d'autres lignes reportées, cf. `carriedReqIds`). */
export function pickCarried(
  rows: CarryRow[],
  previews: Map<string, ParamResolutionPreview>,
  state: Pick<CarryState, 'values' | 'reqSel'>,
  presentOf: (testId: string) => Set<string>,
): PickedCarry[] {
  const out: PickedCarry[] = []
  for (const row of rows) {
    const p = previews.get(row.testCaseId)
    const picked: PickedCarry = {
      campaignId: row.campaignId,
      entryId: row.entryId,
      testCaseId: row.testCaseId,
      ...(row.requirementId && { requirementId: row.requirementId }),
    }
    if (picksRequirements(row, p)) {
      picked.reqInstances = Object.entries(effectiveReqSelection(row.key, p, presentOf(row.testCaseId), state.reqSel))
        .map(([requirementId, paramValues]) => ({ requirementId, paramValues }))
      if (picked.reqInstances.length === 0) continue
    } else {
      const values = carryValuesOf(row, p, state.values)
      if (Object.keys(values).length > 0) picked.paramValues = values
    }
    out.push(picked)
  }
  return out
}

export interface CarryCoverage {
  /** Tests non itérants sans référence à saisir : une seule inclusion possible. */
  tests: Set<string>
  /** Exigences reportées des tests itérants. */
  reqs: Map<string, Set<string>>
}

/**
 * Ce que couvrent les entrées reportées retenues, pour leur priorité sur l'onglet Tests (spec §4.4) :
 * appliquée à l'envoi par l'appelant (`withCarryPrecedence`), sans toucher à la sélection de
 * l'onglet Tests — décocher plus tard une entrée reportée rend au test sa sélection d'origine.
 */
export function carryCoverage(picked: PickedCarry[], previews: Map<string, ParamResolutionPreview>): CarryCoverage {
  const tests = new Set<string>()
  const reqs = new Map<string, Set<string>>()
  const addReq = (testId: string, reqId: string) => {
    const set = reqs.get(testId) ?? new Set<string>()
    set.add(reqId)
    reqs.set(testId, set)
  }
  for (const c of picked) {
    const p = previews.get(c.testCaseId)
    if (isIteratingPreview(p)) {
      if (c.requirementId) addReq(c.testCaseId, c.requirementId)
      for (const r of c.reqInstances ?? []) addReq(c.testCaseId, r.requirementId)
    } else if ((p?.manual.length ?? 0) === 0) {
      tests.add(c.testCaseId)
    }
  }
  return { tests, reqs }
}

/**
 * Priorité au report à l'envoi : tests de l'onglet Tests couverts par une entrée reportée retirés,
 * exigences reportées comptées comme présentes.
 */
export function withCarryPrecedence(
  testIds: string[],
  presentOf: (testId: string) => Set<string>,
  coverage: CarryCoverage,
): { testIds: string[]; presentOf: (testId: string) => Set<string> } {
  return {
    testIds: testIds.filter(id => !coverage.tests.has(id)),
    presentOf: id => new Set([...presentOf(id), ...(coverage.reqs.get(id) ?? [])]),
  }
}

/** Partie envoyée au main (sans les champs d'affichage). */
export function toCarriedSelection(picked: PickedCarry[]): CarriedEntrySelection[] {
  return picked.map(({ campaignId, entryId, paramValues, reqInstances }) => ({
    campaignId, entryId,
    ...(paramValues && { paramValues }),
    ...(reqInstances && { reqInstances }),
  }))
}

/** Toutes les références à saisir sont remplies (même règle que l'onglet Tests). */
export function isCarryComplete(picked: PickedCarry[], previews: Map<string, ParamResolutionPreview>): boolean {
  const filled = (keys: string[], values: Record<string, string> | undefined) => keys.every(k => !!values?.[k]?.trim())
  return picked.every(c => {
    const manual = previews.get(c.testCaseId)?.manual ?? []
    return c.reqInstances
      ? c.reqInstances.every(r => filled(manual, r.paramValues))
      : filled(manual, c.paramValues)
  })
}

/** Nombre d'instances que créeraient les entrées retenues. */
export function countCarryInstances(picked: PickedCarry[]): number {
  return picked.reduce((n, c) => n + (c.reqInstances ? c.reqInstances.length : 1), 0)
}
