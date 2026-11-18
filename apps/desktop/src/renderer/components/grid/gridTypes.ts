import type { ReactNode } from 'react'

/**
 * GH389 — description d'une colonne d'une grille (`DataGrid`). Les colonnes d'une grille sont toutes
 * ses colonnes disponibles ; les visibles, leur ordre, leurs largeurs et le gel viennent des
 * préférences (`useGridPrefs`).
 *
 * Une colonne doit rester **stable** d'un rendu à l'autre (tableau mémoïsé par l'appelant) : elle est
 * passée aux cellules mémoïsées.
 */
export interface GridColumn<R> {
  key: string
  label: string
  /** Groupe du panneau 👁 Colonnes (ex. « Décision », « Exigence »). */
  group?: string
  /** Toujours affichée : case grisée dans le panneau 👁, infobulle `lockedHint`. */
  locked?: boolean
  /** Texte affiché de la cellule : filtre par colonne, largeur auto, export. */
  getText(row: R): string
  /** Rendu de la cellule ; défaut : `getText`. */
  render?(row: R): ReactNode
  /** Éditeur ouvert par double-clic, F2 ou Entrée. */
  editor?: GridEditor
  /** Valeur éditée (valeur d'enum, texte brut) ; défaut : `getText`. */
  editValue?(row: R): string
  /** Ligne éditable dans cette colonne (la grille doit aussi recevoir `onCellEdit`). Défaut : vrai. */
  isEditable?(row: R): boolean
  /** Icône de filtre dans l'en-tête. Défaut : vrai. */
  filterable?: boolean
  /** Texte exporté ; défaut : `getText`. */
  exportText?(row: R): string
  /** URL exportée comme lien hypertexte (valeur `link`). */
  hyperlink?(row: R): string | undefined
  /** ID de l'élément que la cellule désigne : Entrée sur la cellule suit le lien (spec §1.7). */
  elementId?(row: R): string | undefined
}

export type GridEditor =
  | { kind: 'enum'; options: { value: string; label: string }[] }
  | { kind: 'text' }

/** Colonnes de tête techniques : chevron de dépli, case à cocher. Ni déplaçables, ni redimensionnables. */
export const EXPAND_COL = '__expand'
export const CHECK_COL = '__check'
