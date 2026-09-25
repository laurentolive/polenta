// ─── Base de paramètres (T171) ───────────────────────────────────────────────
// Un fichier `parameters/parameters.yaml` par repo (produit ou composant), qui regroupe tous
// les paramètres du repo, clés triées. Référencés par `{nom}` / `{<nœud>::nom}` dans le texte
// des exigences et des tests (cf. ./parameter-refs.ts).

export interface Parameter {
  /** Clé dans parameters.yaml — identifiant, non modifiable. Grammaire PARAM_NAME_RE. */
  name: string
  /** Toujours une chaîne ; peut être vide (référence alors non résolue). */
  value: string
  unit?: string
  description?: string
}

/** Format du fichier `parameters/parameters.yaml`. */
export interface ParametersFile {
  parameters: Record<string, Omit<Parameter, 'name'>>
}

/** Base de paramètres d'un repo du workspace, telle que listée par la vue Paramètres. */
export interface RepoParameters {
  repoPath: string
  /** Nom du repo : nom de montage dans le workspace, ou nom du dossier. */
  repoName: string
  /** Libellé d'affichage (nœud `root` du schéma du repo), si configuré. */
  label?: string
  /** Repo monté sous un nœud submodule `readonly: true` du repo ouvert. */
  readonly: boolean
  parameters: Parameter[]
  /** Nombre d'éléments (exigences + tests, tous repos) qui référencent chaque paramètre. */
  usageCounts: Record<string, number>
}

/** Exigence ou test qui référence un paramètre (« Utilisé par »). */
export interface ParameterUsage {
  elementId: string
  category: 'requirement' | 'test'
  title: string
  status: string
  /** Statut `isApproval` du type de l'élément : une modification du paramètre le marque. */
  isApproval: boolean
  /** Statut `isTerminal` (ex. obsolete) : affiché grisé, ne bloque pas la suppression. */
  isTerminal: boolean
  /** Repo qui contient l'élément (pour ouvrir sa fiche). */
  repoPath: string
  /** Référence telle qu'écrite dans l'élément : `nom` ou `<nœud>::nom`. */
  ref: string
}

export interface ParameterWriteResult {
  /** Éléments marqués `needsRevalidation` par l'écriture (T172 via T171 §9). */
  marked: { id: string; category: 'requirement' | 'test'; repoPath: string }[]
}

export type ParameterDeleteResult =
  | { deleted: true }
  | { deleted: false; usages: ParameterUsage[] }
