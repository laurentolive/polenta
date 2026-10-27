import type { TestStep } from '@polenta/types'

/**
 * GH178 — alignement de deux suites (étapes de test, blocs média d'un richtext, pages d'un
 * `.drawio`) pour les vues de diff : rangées `[indexAvant | null, indexAprès | null]` dans l'ordre
 * d'affichage. Les éléments de même clé sont appariés par LCS ; avec `pairLeftovers`, les éléments
 * restants entre deux ancres sont appariés par position (élément modifié en place).
 */
export type AlignedRow = [number | null, number | null]

export function alignByKey(a: string[], b: string[], pairLeftovers = false): AlignedRow[] {
  const m = a.length
  const n = b.length
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: AlignedRow[] = []
  let pendingA: number[] = []
  let pendingB: number[] = []
  const flush = () => {
    const paired = pairLeftovers ? Math.min(pendingA.length, pendingB.length) : 0
    for (let k = 0; k < paired; k++) rows.push([pendingA[k], pendingB[k]])
    for (const i of pendingA.slice(paired)) rows.push([i, null])
    for (const j of pendingB.slice(paired)) rows.push([null, j])
    pendingA = []
    pendingB = []
  }

  let i = 0
  let j = 0
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      flush()
      rows.push([i, j])
      i++; j++
    } else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) {
      pendingB.push(j++)
    } else {
      pendingA.push(i++)
    }
  }
  flush()
  return rows
}

/**
 * Étapes de test : appariement par contenu (action + résultat attendu), puis par position entre
 * deux étapes identiques (étape modifiée en place). Une étape insérée ne décale pas les suivantes.
 */
export function alignSteps(before: TestStep[], after: TestStep[]): AlignedRow[] {
  const key = (s: TestStep) => `${s?.action ?? ''}\u0000${s?.expectedResult ?? ''}`
  return alignByKey(before.map(key), after.map(key), true)
}

type Page = { id: string; name: string }

/**
 * Pages d'un `.drawio`, clés des deux côtés : nom de la page, ou nom + id quand le nom est en double
 * d'un côté ou de l'autre (même règle des deux côtés, pour qu'une page conservée reste appariée).
 */
export function pageKeys(before: Page[], after: Page[]): [string[], string[]] {
  const duplicated = new Set<string>()
  for (const side of [before, after]) {
    const seen = new Set<string>()
    for (const p of side) {
      if (seen.has(p.name)) duplicated.add(p.name)
      seen.add(p.name)
    }
  }
  const key = (p: Page) => (duplicated.has(p.name) ? `${p.name}\u0000${p.id}` : p.name)
  return [before.map(key), after.map(key)]
}
