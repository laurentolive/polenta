import type { Parameter } from './parameter'
import type { TestCase } from './test'

// ─── Références de paramètres (T171) ─────────────────────────────────────────
// Seule définition de la grammaire `{nom}` / `{<nœud>::nom}`, partagée par le main (usages,
// résolution en campagne) et le renderer (rendu, exports) pour qu'ils reconnaissent exactement
// les mêmes références. `{nom}` seul est la syntaxe des paramètres de test T97.

/** Grammaire d'un nom de paramètre (et d'un label T97). */
export const PARAM_NAME_RE = /^[A-Za-z0-9_-]+$/

/** Nouvelle instance à chaque appel : une RegExp `g` partagée garde son `lastIndex`. */
export function paramRefRegExp(): RegExp {
  return /\{(?:([A-Za-z0-9_-]+)::)?([A-Za-z0-9_-]+)\}/g
}

export interface ParamRef {
  /** Texte source, accolades comprises. */
  raw: string
  /** Nœud submodule visé (forme `{<nœud>::nom}`), absent pour une référence locale. */
  node?: string
  name: string
  /** Clé de la référence : `nom` ou `<nœud>::nom`. */
  key: string
  index: number
}

export function parseParamRefs(text: string | null | undefined): ParamRef[] {
  if (!text) return []
  const refs: ParamRef[] = []
  for (const m of text.matchAll(paramRefRegExp())) {
    const node = m[1]
    const name = m[2]
    refs.push({ raw: m[0], node, name, key: node ? `${node}::${name}` : name, index: m.index ?? 0 })
  }
  return refs
}

/** Clés distinctes, dans l'ordre de première apparition, sur une suite de textes. */
function distinctKeys(texts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const text of texts) {
    for (const ref of parseParamRefs(text)) {
      if (!seen.has(ref.key)) {
        seen.add(ref.key)
        ordered.push(ref.key)
      }
    }
  }
  return ordered
}

/** Clés référencées par un test, dans l'ordre T97 : preconditions → étapes (triées par
 *  `order`, action puis expectedResult) → postconditions. `notes` n'est pas scanné. */
export function extractTestParamRefs(tc: Pick<TestCase, 'preconditions' | 'postconditions' | 'steps'>): string[] {
  const texts: Array<string | null | undefined> = [tc.preconditions]
  for (const step of [...(tc.steps ?? [])].sort((a, b) => a.order - b.order)) {
    texts.push(step.action, step.expectedResult)
  }
  texts.push(tc.postconditions)
  return distinctKeys(texts)
}

/** Clés référencées par les champs `fieldNames` d'une exigence (champs text/textarea/richtext,
 *  à déterminer par l'appelant depuis le type ; le titre n'est jamais scanné). */
export function extractFieldParamRefs(fields: Record<string, unknown> | undefined, fieldNames: string[]): string[] {
  const texts = fieldNames.map((n) => {
    const v = fields?.[n]
    return typeof v === 'string' ? v : null
  })
  return distinctKeys(texts)
}

/** Texte substitué : `value`, suivi de ` <unit>` si renseignée ; `null` si `value` est vide. */
export function formatParamValue(p: Pick<Parameter, 'value' | 'unit'>): string | null {
  const value = (p.value ?? '').trim()
  if (!value) return null
  const unit = (p.unit ?? '').trim()
  return unit ? `${value} ${unit}` : value
}

/** Remplace chaque référence par `lookup(key)` ; une valeur absente ou vide laisse la
 *  référence littérale (règle T97 `substituteParams`). */
export function substituteParamRefs(text: string, lookup: (key: string) => string | null | undefined): string {
  return text.replace(paramRefRegExp(), (match: string, node: string | undefined, name: string) => {
    const value = lookup(node ? `${node}::${name}` : name)
    return value && value.trim() ? value : match
  })
}
