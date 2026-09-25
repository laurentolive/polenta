import type { Parameter } from './parameter'
import type { TestCase } from './test'

// ─── Références de paramètres (T171) ─────────────────────────────────────────
// Seule définition de la grammaire `{nom}` / `{<nœud>::nom}`, partagée par le main (usages,
// résolution en campagne) et le renderer (rendu, exports) pour qu'ils reconnaissent exactement
// les mêmes références. `{nom}` seul est la syntaxe des paramètres de test T97.

/** Grammaire d'un nom de paramètre (et d'un label T97). */
export const PARAM_NAME_RE = /^[A-Za-z0-9_-]+$/

/** Nouvelle instance à chaque appel : une RegExp `g` partagée garde son `lastIndex`.
 *  Tolère `\_` : le sérialiseur Markdown de l'éditeur (prosemirror-markdown) échappe un `_`
 *  qui n'est pas entouré de lettres (`{_x}` → `{\_x}`) ; les groupes sont à normaliser avec
 *  `unescapeRefPart`. */
export function paramRefRegExp(): RegExp {
  return /\{(?:((?:[A-Za-z0-9-]|\\?_)+)::)?((?:[A-Za-z0-9-]|\\?_)+)\}/g
}

/** Retire l'échappement Markdown `\_` d'un groupe capturé par `paramRefRegExp`. */
export function unescapeRefPart(part: string): string
export function unescapeRefPart(part: string | undefined): string | undefined
export function unescapeRefPart(part: string | undefined): string | undefined {
  return part === undefined ? undefined : part.replace(/\\_/g, '_')
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
    const node = unescapeRefPart(m[1])
    const name = unescapeRefPart(m[2])
    refs.push({ raw: m[0], node, name, key: node ? `${node}::${name}` : name, index: m.index ?? 0 })
  }
  return refs
}

/** Code Markdown (blocs ``` / ~~~ et code inline) remplacé par des espaces, indices conservés :
 *  une référence écrite dans du code reste littérale à l'affichage, elle n'est donc ni comptée
 *  ni substituée. */
export function maskMarkdownCode(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/`[^`\n]*`/g, blank)
}

/** Références d'un texte Markdown, hors code. */
export function parseMarkdownParamRefs(text: string | null | undefined): ParamRef[] {
  if (!text) return []
  const masked = maskMarkdownCode(text)
  return parseParamRefs(masked)
}

/** Clés distinctes, dans l'ordre de première apparition, sur une suite de textes Markdown. */
function distinctKeys(texts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const text of texts) {
    for (const ref of parseMarkdownParamRefs(text)) {
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

/** Comme `substituteParamRefs`, mais laisse intactes les références écrites dans du code
 *  Markdown (même règle que l'affichage). */
export function substituteMarkdownParamRefs(text: string, lookup: (key: string) => string | null | undefined): string {
  const refs = parseMarkdownParamRefs(text)
  if (refs.length === 0) return text
  let out = ''
  let last = 0
  for (const ref of refs) {
    const value = lookup(ref.key)
    out += text.slice(last, ref.index) + (value && value.trim() ? value : text.slice(ref.index, ref.index + ref.raw.length))
    last = ref.index + ref.raw.length
  }
  return out + text.slice(last)
}

/** Remplace chaque référence par `lookup(key)` ; une valeur absente ou vide laisse la
 *  référence littérale (règle T97 `substituteParams`). */
export function substituteParamRefs(text: string, lookup: (key: string) => string | null | undefined): string {
  return text.replace(paramRefRegExp(), (match: string, rawNode: string | undefined, rawName: string) => {
    const node = unescapeRefPart(rawNode)
    const name = unescapeRefPart(rawName)
    const value = lookup(node ? `${node}::${name}` : name)
    return value && value.trim() ? value : match
  })
}
