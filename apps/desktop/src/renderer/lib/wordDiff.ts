// GH145 — diff mot à mot de deux textes (énoncé avant / après dans l'analyse d'impact).
// Plus longue sous-séquence commune sur les jetons « mot » et « espaces » : les espaces sont des
// jetons à part entière, le texte se reconstitue donc à l'identique par concaténation.

export type DiffPart = { kind: 'same' | 'removed' | 'added'; text: string }

/** Au-delà, la table LCS (n × m) coûterait trop : diff grossier « tout retiré / tout ajouté ». */
const MAX_CELLS = 250_000

function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t !== '')
}

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before)
  const b = tokenize(after)
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }

  if (a.length * b.length > MAX_CELLS) {
    if (before) push('removed', before)
    if (after) push('added', after)
    return parts
  }

  // lcs[i][j] = longueur de la LCS de a[i..] et b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]!); i++; j++ }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { push('removed', a[i]!); i++ }
    else { push('added', b[j]!); j++ }
  }
  while (i < a.length) push('removed', a[i++]!)
  while (j < b.length) push('added', b[j++]!)
  return parts
}

/** Valeur d'un champ du diff (`changedFields[].from/to`) rendue en texte. */
export function diffValueText(v: unknown): string {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}
