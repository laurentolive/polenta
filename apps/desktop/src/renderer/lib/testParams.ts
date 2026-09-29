import type { CampaignTestRun, TestCase } from '@polenta/types'
import { extractTestParamRefs, isReqRefKey, parseParamRefs, substituteMarkdownParamRefs, substituteParamRefs } from '@polenta/types'

// T97 → T171 : la syntaxe `{nom}` des paramètres de test est celle de la base de paramètres
// (`@polenta/types` parameter-refs). À l'ajout en campagne, le main résout les références
// présentes dans la base (`resolvedParams`, figées) ; seules les références locales absentes de
// la base restent à saisir à la main (`paramValues`, T97). Ces helpers ne font que lire ce que la
// campagne a figé — la résolution elle-même est côté main (`campaigns:preview-params`).

type ParamScannable = Pick<TestCase, 'preconditions' | 'postconditions' | 'steps'>

/** Valeur figée d'une référence pour une instance : base (`resolvedParams`), puis saisie. */
export function runParamLookup(run: Pick<CampaignTestRun, 'resolvedParams' | 'paramValues'> | undefined) {
  return (key: string): string | undefined => run?.resolvedParams?.[key] ?? run?.paramValues?.[key]
}

type RunParams = Pick<CampaignTestRun, 'resolvedParams' | 'paramValues' | 'unresolvedParams' | 'paramSourceRef'>

/** Instance ajoutée depuis T171 (résolution depuis la base) ; sinon instance T97 historique. */
export function isT171Run(run: RunParams | undefined): boolean {
  return !!run && (run.resolvedParams !== undefined || run.unresolvedParams !== undefined || run.paramSourceRef !== undefined)
}

/**
 * Remplace chaque référence par sa valeur figée dans l'instance ; une référence sans valeur
 * reste littérale (non résolue, ou saisie vidée), comme en T97. Instance T171 : le code Markdown
 * est laissé tel quel (même règle qu'à l'écran). Instance antérieure : substitution T97 partout,
 * code compris, pour ne rien changer à l'affichage des campagnes existantes.
 */
export function substituteRunParams(text: string, run: RunParams | undefined): string {
  if (!text) return text
  return isT171Run(run)
    ? substituteMarkdownParamRefs(text, runParamLookup(run))
    : substituteParamRefs(text, runParamLookup(run))
}

/** Copie du test dont les champs scannés (T171 §3) portent les valeurs figées de l'instance. */
export function substituteTestParams<T extends ParamScannable>(test: T, run: RunParams | undefined): T {
  return {
    ...test,
    preconditions: substituteRunParams(test.preconditions, run),
    postconditions: substituteRunParams(test.postconditions, run),
    steps: (test.steps ?? []).map(s => ({
      ...s,
      action: substituteRunParams(s.action, run),
      expectedResult: substituteRunParams(s.expectedResult, run),
    })),
  }
}

/**
 * Références **à saisir** d'une instance existante (édition de ses valeurs). Instance T171 : toutes
 * les références du test sauf celles figées depuis la base ou non résolues. Instance antérieure à
 * T171 (aucun champ de résolution) : références locales seulement — T97 ne reconnaissait pas la
 * forme `{<nœud>::nom}`.
 */
export function manualKeysForRun(run: CampaignTestRun, test: ParamScannable): string[] {
  if (!isT171Run(run)) {
    // T97 : toutes les références locales, code compris (grammaire et scan d'origine).
    const texts = [test.preconditions, ...[...(test.steps ?? [])].sort((a, b) => a.order - b.order)
      .flatMap(s => [s.action, s.expectedResult]), test.postconditions]
    // `{req.<champ>}` (T179) n'existait pas : jamais à saisir.
    return [...new Set(texts.flatMap(t => parseParamRefs(t).map(r => r.key)))].filter(k => !k.includes('::') && !isReqRefKey(k))
  }
  const keys = extractTestParamRefs(test)
  const unresolved = new Set((run.unresolvedParams ?? []).map(u => u.ref))
  // T179 — `{req.<champ>}` : figée depuis l'exigence de l'instance ou non résolue, jamais saisie.
  return keys.filter(k => run.resolvedParams?.[k] === undefined && !unresolved.has(k) && !isReqRefKey(k))
}

/** Vrai si chaque référence à saisir de chaque test sélectionné a une valeur non vide. */
export function isParamsComplete(
  selectedIds: Iterable<string>,
  manualKeysById: Map<string, string[]>,
  paramValues: Record<string, Record<string, string>>,
): boolean {
  for (const id of selectedIds) {
    for (const label of manualKeysById.get(id) ?? []) {
      const value = paramValues[id]?.[label]
      if (!value || !value.trim()) return false
    }
  }
  return true
}
