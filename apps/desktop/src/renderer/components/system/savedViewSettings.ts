import type { FieldVisibilityPatch } from '@polenta/api-client'

/** GH203 — mise en page de la Vue Système mémorisée par une vue enregistrée (`settings`). */
export interface ViewLayout {
  excel: string[]
  word: string[]
  popup: string[]
  showFoldersExcel: boolean
  showFoldersWord: boolean
  freezeColCountExcel: number
}

const stringList = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every(s => typeof s === 'string') ? v : undefined
const flag = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const count = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined)

/** Une clé absente ou invalide (fichier d'équipe édité à la main) vaut le défaut. */
export function resolveLayout(settings: Record<string, unknown>, defaults: { excel: string[]; word: string[] }): ViewLayout {
  return {
    excel: stringList(settings.excel) ?? defaults.excel,
    word: stringList(settings.word) ?? defaults.word,
    popup: stringList(settings.popup) ?? [],
    showFoldersExcel: flag(settings.showFoldersExcel) ?? true,
    showFoldersWord: flag(settings.showFoldersWord) ?? true,
    freezeColCountExcel: count(settings.freezeColCountExcel) ?? 0,
  }
}

/** Écriture partielle du `.pref` : toutes les clés de la mise en page, `null` si absente de la vue ;
 *  `picker`, `executions`, les dossiers repliés ne sont pas concernés et restent intacts. */
export function layoutPatch(settings: Record<string, unknown>): FieldVisibilityPatch {
  return {
    excel: stringList(settings.excel) ?? null,
    word: stringList(settings.word) ?? null,
    popup: stringList(settings.popup) ?? null,
    showFoldersExcel: flag(settings.showFoldersExcel) ?? null,
    showFoldersWord: flag(settings.showFoldersWord) ?? null,
    freezeColCountExcel: count(settings.freezeColCountExcel) ?? null,
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i])

/** L'ordre des colonnes compte : c'est un réglage de la vue. */
export function sameLayout(a: ViewLayout, b: ViewLayout): boolean {
  return sameList(a.excel, b.excel) && sameList(a.word, b.word) && sameList(a.popup, b.popup)
    && a.showFoldersExcel === b.showFoldersExcel && a.showFoldersWord === b.showFoldersWord
    && a.freezeColCountExcel === b.freezeColCountExcel
}
