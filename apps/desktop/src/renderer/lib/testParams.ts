import type { TestCase } from '@polenta/types'

const PARAM_RE = /\{([A-Za-z0-9_-]+)\}/g

type ParamScannable = Pick<TestCase, 'preconditions' | 'postconditions' | 'steps'>

/**
 * Labels {label} uniques d'un test, dans l'ordre de première apparition :
 * preconditions → étapes (triées par `order`, action puis expectedResult) → postconditions.
 * La référence {label} EST la déclaration (pas de liste séparée) — cf. specs/T97.md.
 * `TestStep.notes` n'est volontairement pas scanné : ce champ n'est affiché nulle part
 * dans le contexte d'une campagne (exécution ni relecture), donc un paramètre qui n'y
 * apparaîtrait que là n'aurait aucun effet visible une fois sa valeur saisie.
 */
export function extractTestParameters(testCase: ParamScannable): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []

  const scan = (text: string | null | undefined) => {
    if (!text) return
    for (const m of text.matchAll(PARAM_RE)) {
      const label = m[1]
      if (!seen.has(label)) {
        seen.add(label)
        ordered.push(label)
      }
    }
  }

  scan(testCase.preconditions)
  for (const step of [...testCase.steps].sort((a, b) => a.order - b.order)) {
    scan(step.action)
    scan(step.expectedResult)
  }
  scan(testCase.postconditions)

  return ordered
}

/**
 * Remplace chaque {label} par sa valeur. Le texte des champs scannés (preconditions,
 * steps, postconditions) est du Markdown (sérialisé par tiptap-markdown, cf.
 * RichTextField.onUpdate) rendu ensuite via RichTextViewer, configuré `html: false` —
 * markdown-it échappe déjà tout HTML littéral présent dans une valeur substituée lors du
 * rendu, donc aucun échappement manuel n'est nécessaire ici (un double-échappement casserait
 * l'affichage, ex. "&" saisi deviendrait littéralement "&amp;" à l'écran).
 * Une valeur vide ou absente pour un label est traitée comme "pas de valeur" : le
 * placeholder reste affiché tel quel plutôt que de silencieusement disparaître (test
 * modifié depuis l'ajout en campagne, ou valeur effacée par erreur — cf. specs/T97.md
 * "Cas limite").
 */
export function substituteParams(text: string, values: Record<string, string> | undefined): string {
  if (!values || Object.keys(values).length === 0) return text
  return text.replace(PARAM_RE, (match, label: string) => {
    const value = values[label]
    return value && value.trim() ? value : match
  })
}

/** Vrai si chaque paramètre détecté de chaque test sélectionné a une valeur non vide. */
export function isParamsComplete(
  selectedIds: Iterable<string>,
  testMap: Map<string, TestCase>,
  paramValues: Record<string, Record<string, string>>,
): boolean {
  for (const id of selectedIds) {
    const tc = testMap.get(id)
    if (!tc) continue
    for (const label of extractTestParameters(tc)) {
      const value = paramValues[id]?.[label]
      if (!value || !value.trim()) return false
    }
  }
  return true
}
