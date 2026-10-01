// GH34 sprint 4 — réécriture des références de cellules d'un classeur après expansion des lignes
// modèles (`${table:…}`) par xlsx-template. Cette lib duplique les lignes et décale les cellules,
// fusions, tableaux et images, mais laisse les formules, mises en forme conditionnelles,
// validations de données, séries de graphiques et noms définis pointer sur la seule ligne modèle :
// un `=SOMME(D6:D6)` sous le tableau ne totaliserait que la première ligne. Toutes les références
// s'expriment ici en coordonnées du **gabarit** (le texte des formules n'est jamais modifié par
// xlsx-template) et sont projetées dans le classeur produit.

/** Ligne modèle d'une feuille : ligne `row` (1-based, gabarit) devenue `count` lignes (≥ 0). */
export interface RowExpansion {
  row: number
  count: number
}

export type ExpansionsBySheet = Map<string, RowExpansion[]>

/** Projection des lignes d'une feuille du gabarit vers le classeur produit. */
export class RowMap {
  constructor(private readonly expansions: RowExpansion[]) {}

  /** Lignes ajoutées (ou retirées si négatif) par la ligne modèle `e`. */
  private static added(e: RowExpansion): number {
    return e.count - 1
  }

  /** Nouvelle position d'une ligne (première ligne générée pour une ligne modèle). */
  row(r: number): number {
    let out = r
    for (const e of this.expansions) if (e.row < r) out += RowMap.added(e)
    return out
  }

  /** Nouvelle fin d'une plage se terminant en `r` : inclut les lignes générées si `r` est modèle. */
  rangeEnd(r: number): number {
    let out = r
    for (const e of this.expansions) if (e.row <= r) out += RowMap.added(e)
    return out
  }

  /** Ligne modèle (gabarit) et rang `k` si `newRow` (produit) est une ligne générée, sinon null. */
  generated(newRow: number): { row: number; k: number } | null {
    for (const e of this.expansions) {
      const start = this.row(e.row)
      if (newRow >= start && newRow < start + Math.max(e.count, 1)) return { row: e.row, k: newRow - start }
    }
    return null
  }

  get isEmpty(): boolean {
    return this.expansions.every(e => e.count === 1)
  }
}

// Référence A1 : qualificatif de feuille facultatif, cellule, et seconde cellule d'une plage.
// Garde-fous : pas précédée d'un caractère d'identifiant (ex. `LOG10(`, `Feuil1`), pas suivie de
// `(` (nom de fonction) ni d'un caractère d'identifiant.
const REF = /(?<![A-Za-z0-9_.$\]])((?:'(?:[^']|'')+'|[A-Za-z_À-ɏ][\w.À-ɏ]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![\w(À-ɏ])/g
const STRING_LITERAL = /"(?:[^"]|"")*"/g

function unquoteSheet(qualifier: string): string {
  const name = qualifier.slice(0, -1)
  return name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name
}

export interface FormulaContext {
  /** Feuille contenant la formule (références non qualifiées). Absent : noms définis, graphiques. */
  sheet?: string
  /** Ligne (classeur produit) de la cellule portant la formule, pour les lignes générées. */
  cellRow?: number
}

/**
 * Projette les références d'une formule. Hors lignes générées : une plage couvrant une ligne
 * modèle s'étend aux lignes générées (`SOMME(D6:D6)` → `SOMME(D6:D8)`), le reste est décalé.
 * Dans une ligne générée (formule de la ligne modèle recopiée), sémantique d'une recopie vers le
 * bas dans Excel : aucune extension, et toute composante de ligne **relative** se décale du rang
 * `k` de la ligne (`=D6*2` → `=D7*2` ; cumul `=SOMME(D$6:D6)` → `=SOMME(D$6:D7)` ; `=D6-D5` →
 * `=D7-D6`), sur toutes les feuilles. `asArea` : chaque référence est une zone (`sqref`/`ref`),
 * une cellule seule s'étend comme une plage d'une ligne.
 */
export function rewriteFormula(formula: string, maps: Map<string, RowMap>, ctx: FormulaContext, asArea = false): string {
  // Les littéraux de chaîne ne sont jamais réécrits.
  let out = ''
  let last = 0
  for (const m of formula.matchAll(STRING_LITERAL)) {
    out += rewriteRefs(formula.slice(last, m.index), maps, ctx, asArea) + m[0]
    last = (m.index ?? 0) + m[0].length
  }
  return out + rewriteRefs(formula.slice(last), maps, ctx, asArea)
}

function rewriteRefs(text: string, maps: Map<string, RowMap>, ctx: FormulaContext, asArea: boolean): string {
  // Cellule portant la formule dans une ligne générée de sa propre feuille ?
  const ownMap = ctx.sheet ? maps.get(ctx.sheet) : undefined
  const gen = ownMap && ctx.cellRow !== undefined ? ownMap.generated(ctx.cellRow) : null

  return text.replace(REF, (whole, qualifier: string | undefined, c1a, col1, r1a, row1, c2a, col2, r2a, row2) => {
    const sheet = qualifier ? unquoteSheet(qualifier) : ctx.sheet
    const map = sheet ? maps.get(sheet) : undefined
    const q = qualifier ?? ''
    const r1 = Number(row1)

    if (gen) {
      // Recopie vers le bas : projection ponctuelle + décalage `k` des composantes relatives.
      const at = (r: number, absolute: string) => (map ? map.row(r) : r) + (absolute ? 0 : gen.k)
      if (gen.k === 0 && !map) return whole
      if (col2 === undefined) return `${q}${c1a}${col1}${r1a}${at(r1, r1a)}`
      return `${q}${c1a}${col1}${r1a}${at(r1, r1a)}:${c2a}${col2}${r2a}${at(Number(row2), r2a)}`
    }

    if (!map) return whole
    if (col2 === undefined) {
      if (asArea) {
        const start = map.row(r1)
        const end = map.rangeEnd(r1)
        const first = `${q}${c1a}${col1}${r1a}${start}`
        return end === start ? first : `${first}:${c1a}${col1}${r1a}${end}`
      }
      return `${q}${c1a}${col1}${r1a}${map.row(r1)}`
    }
    return `${q}${c1a}${col1}${r1a}${map.row(r1)}:${c2a}${col2}${r2a}${map.rangeEnd(Number(row2))}`
  })
}
