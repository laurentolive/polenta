import { useCallback, useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { ComputedCell, SavedQuery, ScriptRunResult, SchemaField, SchemaFieldType } from '@polenta/types'
import { columnAppliesTo, columnFieldDef, columnLabel, columnValuesFromRows, computedColumnKey, isComputedColumnKey } from '@polenta/types'
import { api } from '../api'
import i18n from '../i18n'
import { runOptions, scriptErrorText } from './useScriptRun'

/**
 * GH70 — colonnes calculées définies par le projet (specs/GH70-design.md §3.1). Une colonne est une
 * requête partagée du repo ouvert du projet qui déclare `column` ; elle est proposée pour le type
 * affiché si `appliesTo` le désigne. Le script d'une colonne **visible** est exécuté une fois pour
 * toute la vue (`suivi:run`, clé `['widget-query-result', …]` : rafraîchie par `useLiveFileSync`
 * comme les widgets) et ses valeurs sont fusionnées dans les objets affichés sous la clé
 * `query::<ID>` — les vues les lisent alors comme tout autre champ (cellule, filtres, exports).
 * Aucune connaissance de ce que calcule le script.
 */

export interface ComputedColumn {
  /** `query::<ID>` */
  key: string
  queryId: string
  /** Libellé dans la langue courante. */
  label: string
  queryTitle: string
  /** Champ synthétique : la cellule est rendue comme un champ de ce type. */
  fieldDef: SchemaField
}

export interface ComputedColumnResult {
  values: Map<string, ComputedCell>
  /** Erreur d'exécution ou de lignes (message lisible, fichier et ligne si connus). */
  error?: string
  pending: boolean
}

export interface ComputedColumnsState {
  /** Colonnes applicables au type affiché (panneau ⚙️), triées par libellé. */
  available: ComputedColumn[]
  /** Résultats des colonnes visibles, par clé. */
  results: Map<string, ComputedColumnResult>
  /** Vrai tant qu'une colonne visible attend son résultat. */
  pending: boolean
  /** Liste des colonnes connue et résultats des colonnes visibles reçus (impression). */
  ready: boolean
  /** Objets normalisés + valeurs `query::…` des colonnes visibles. */
  merge: <T extends Record<string, string>>(objects: T[]) => T[]
  /** Colonnes applicables et leur résultat, par clé (props `computedColumns` des vues). */
  columnsMap: Map<string, { column: ComputedColumn; result?: ComputedColumnResult }>
  /** Libellé et type de chaque colonne applicable (exports). */
  exportColumns: Map<string, { label: string; type: SchemaFieldType }>
  /** Retire les clés de colonnes inconnues (requête supprimée, privée, non applicable) — sans
   *  jamais réécrire les préférences. */
  filterFields: (fields: string[]) => string[]
  /** Repo ouvert du projet (celui des requêtes), pour ouvrir la cible d'une cellule. */
  projectRepoPath: string
}

const EMPTY_VALUES = new Map<string, ComputedCell>()

export function useComputedColumns(opts: {
  workspaceDir: string
  category: string | undefined
  objectTypeRef: string | undefined
  /** Clés de colonnes affichées dans la vue courante (seules celles-ci sont exécutées). */
  visibleKeys: readonly string[]
  enabled?: boolean
}): ComputedColumnsState {
  const { workspaceDir, category, objectTypeRef, visibleKeys, enabled = true } = opts
  const locale = (i18n.resolvedLanguage ?? i18n.language ?? 'fr').startsWith('en') ? 'en' : 'fr'

  // Repo ouvert du projet, quel que soit le repo sélectionné dans la Vue Système (T72) : les
  // requêtes, donc les colonnes, sont celles du projet (comme la vue Suivi).
  const { data: project, isError: projectFailed } = useQuery({
    queryKey: ['computed-columns-project', workspaceDir],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: enabled && !!workspaceDir,
  })
  const projectRepoPath = project?.localPath ?? ''
  const { data: identityLogin, isError: identityError } = useQuery({
    queryKey: ['project-username', projectRepoPath],
    queryFn: () => api.auth.projectUsername(projectRepoPath),
    enabled: !!projectRepoPath,
    retry: false,
  })
  const username = identityLogin ?? (identityError ? 'local' : '')
  const { data: queries = [], isSuccess: queriesLoaded, isError: queriesFailed } = useQuery<SavedQuery[]>({
    queryKey: ['queries', projectRepoPath, username],
    queryFn: () => api.queries.list(projectRepoPath, username),
    enabled: !!projectRepoPath && !!username,
  })

  const applicable = useMemo(() => queries
    .filter((q) => q.scope === 'shared' && q.column && !q.state.readOnly && columnAppliesTo(q.column, category, objectTypeRef))
    .map((q) => ({ query: q, column: q.column! })), [queries, category, objectTypeRef])

  const available = useMemo<ComputedColumn[]>(() => applicable
    .map(({ query, column }) => ({
      key: computedColumnKey(query.id),
      queryId: query.id,
      label: columnLabel(column, locale),
      queryTitle: query.title,
      fieldDef: columnFieldDef(query.id, column, locale),
    }))
    .sort((a, b) => a.label.localeCompare(b.label)), [applicable, locale])

  const visible = useMemo(() => {
    const keys = new Set(visibleKeys.filter(isComputedColumnKey))
    return applicable.filter(({ query }) => keys.has(computedColumnKey(query.id))).map(({ query }) => query)
  }, [applicable, visibleKeys])

  const runs = useQueries({
    queries: visible.map((q) => ({
      ...runOptions(projectRepoPath, workspaceDir, username, { queryId: q.id }),
      // Le script fait partie de la clé : une requête modifiée est réexécutée.
      queryKey: ['widget-query-result', projectRepoPath, workspaceDir, username, 'column', q.id, q.script],
    })),
  })
  // `useQueries` renvoie un nouveau tableau à chaque rendu : la signature des données sert de clé.
  const runsSig = runs.map((r) => `${r.dataUpdatedAt}:${r.errorUpdatedAt}:${r.isPending ? 'p' : 'd'}`).join('|')

  const results = useMemo(() => {
    const out = new Map<string, ComputedColumnResult>()
    visible.forEach((q, i) => {
      const r = runs[i]
      const data = r?.data as ScriptRunResult | undefined
      if (!data) {
        const message = r?.error instanceof Error ? r.error.message : r?.error ? String(r.error) : undefined
        out.set(computedColumnKey(q.id), { values: EMPTY_VALUES, pending: !!r?.isPending, ...(message ? { error: message } : {}) })
        return
      }
      if (!data.ok) {
        out.set(computedColumnKey(q.id), { values: EMPTY_VALUES, pending: false, error: scriptErrorText(data.error) })
        return
      }
      const { values, error } = columnValuesFromRows(data.rows, q.column)
      out.set(computedColumnKey(q.id), { values, pending: false, ...(error ? { error } : {}) })
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, runsSig])

  const merge = useCallback(<T extends Record<string, string>>(objects: T[]): T[] => {
    if (results.size === 0) return objects
    return objects.map((o) => {
      const extra: Record<string, string> = {}
      for (const [key, res] of results) extra[key] = res.values.get(o.id)?.value ?? ''
      return { ...o, ...extra }
    })
  }, [results])

  const pending = [...results.values()].some((r) => r.pending)
  // Projet introuvable ou liste en échec : rien à attendre (l'impression ne doit pas rester bloquée).
  const ready = !enabled || !workspaceDir || projectFailed || queriesFailed || (queriesLoaded && !pending)

  const columnsMap = useMemo(() => new Map(available.map((c) => [c.key, { column: c, result: results.get(c.key) }])), [available, results])
  const exportColumns = useMemo(() => new Map(available.map((c) => [c.key, { label: c.label, type: c.fieldDef.type }])), [available])
  const filterFields = useCallback((fields: string[]) => fields.filter((f) => !isComputedColumnKey(f) || columnsMap.has(f)), [columnsMap])
  return { available, results, pending, ready, merge, projectRepoPath, columnsMap, exportColumns, filterFields }
}
