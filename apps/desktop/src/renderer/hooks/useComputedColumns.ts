import { useCallback, useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { ComputedCell, SavedQuery, ScriptRunResult, SchemaField, SchemaFieldType, SplitColumnValues } from '@polenta/types'
import {
  columnAppliesTo, columnFieldDef, columnLabel, columnValuesFromRows, computedColumnKey, isComputedColumnKey,
  parseComputedColumnKey, splitColumnValuesFromRows,
} from '@polenta/types'
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
 *
 * GH126 — une colonne **éclatée** (`splitColumn`) est déployée ici en sous-colonnes ordinaires de clé
 * `query::<ID>::<valeur>` (specs/GH126-design.md §2) : les vues n'en savent rien, seul le panneau ⚙️
 * les présente en groupe (`panel`).
 */

export interface ComputedColumn {
  /** `query::<ID>`, ou `query::<ID>::<valeur>` pour une sous-colonne (GH126). */
  key: string
  queryId: string
  /** Libellé dans la langue courante. */
  label: string
  queryTitle: string
  /** Champ synthétique : la cellule est rendue comme un champ de ce type. */
  fieldDef: SchemaField
  /** GH126 — infobulle d'en-tête : « ID — titre », ou « libellé du groupe — libellé » (sous-colonne). */
  headerTitle: string
  /** GH126 — sous-colonne d'une colonne éclatée : sa valeur et le libellé du groupe. */
  split?: { value: string; groupLabel: string }
}

/** GH126 — entrée du panneau ⚙️ : colonne simple, ou groupe d'une colonne éclatée (sous-colonnes du
 *  résultat ; en chargement ou en erreur, les sous-colonnes visibles, pour rester décochables). */
export type ComputedColumnPanelEntry =
  | { kind: 'column'; column: ComputedColumn }
  | { kind: 'group'; queryId: string; label: string; queryTitle: string; pending: boolean; error?: string; columns: ComputedColumn[] }

export interface ComputedColumnResult {
  values: Map<string, ComputedCell>
  /** Erreur d'exécution ou de lignes (message lisible, fichier et ligne si connus). */
  error?: string
  pending: boolean
}

export interface ComputedColumnsState {
  /** Colonnes applicables au type affiché, à plat (sous-colonnes déployées), dans l'ordre du ⚙️ :
   *  par libellé (de groupe), sous-colonnes dans l'ordre du script. */
  available: ComputedColumn[]
  /** GH126 — entrées du panneau ⚙️ (colonnes simples et groupes), même ordre. */
  panel: ComputedColumnPanelEntry[]
  /** Résultats des colonnes exécutées, par clé. */
  results: Map<string, ComputedColumnResult>
  /** Vrai tant qu'une colonne visible attend son résultat. */
  pending: boolean
  /** Liste des colonnes connue et résultats des colonnes visibles reçus (impression). */
  ready: boolean
  /** Objets normalisés + valeurs `query::…` des colonnes exécutées. */
  merge: <T extends Record<string, string>>(objects: T[]) => T[]
  /** Colonnes applicables et leur résultat, par clé (props `computedColumns` des vues). */
  columnsMap: Map<string, { column: ComputedColumn; result?: ComputedColumnResult }>
  /** Libellé et type de chaque colonne applicable (exports). */
  exportColumns: Map<string, { label: string; type: SchemaFieldType }>
  /** Retire les clés de colonnes inconnues (requête supprimée, privée, non applicable, sous-colonne
   *  absente du résultat) — sans jamais réécrire les préférences. */
  filterFields: (fields: string[]) => string[]
  /** Repo ouvert du projet (celui des requêtes), pour ouvrir la cible d'une cellule. */
  projectRepoPath: string
}

const EMPTY_VALUES = new Map<string, ComputedCell>()

/** Résultat d'une colonne exécutée, analysé. */
interface ParsedRun {
  pending: boolean
  error?: string
  /** Colonne simple. */
  values?: Map<string, ComputedCell>
  /** Colonne éclatée, résultat valide. */
  split?: SplitColumnValues[]
}

/** GH126 — sous-colonnes (valeur, libellé) du dernier résultat valide de chaque colonne éclatée, pour
 *  la session : colonnes de substitution fidèles pendant un chargement ou une erreur. */
const lastKnownSplits = new Map<string, { value: string; label: string }[]>()
const splitMemoKey = (repoPath: string, queryId: string) => `${repoPath}\u0000${queryId}`

export function useComputedColumns(opts: {
  workspaceDir: string
  category: string | undefined
  objectTypeRef: string | undefined
  /** Clés de colonnes affichées dans la vue courante (seules celles-ci sont exécutées). */
  visibleKeys: readonly string[]
  enabled?: boolean
  /** GH126 — exécuter aussi les colonnes éclatées applicables non visibles, pour lister leurs
   *  sous-colonnes (panneau ⚙️ ouvert). */
  discover?: boolean
}): ComputedColumnsState {
  const { workspaceDir, category, objectTypeRef, visibleKeys, enabled = true, discover = false } = opts
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

  // Clés visibles par requête : `null` = la colonne simple, sinon les valeurs des sous-colonnes (GH126).
  const visibleByQuery = useMemo(() => {
    const out = new Map<string, Set<string | null>>()
    for (const k of visibleKeys) {
      const p = parseComputedColumnKey(k)
      if (!p) continue
      if (!out.has(p.queryId)) out.set(p.queryId, new Set())
      out.get(p.queryId)!.add(p.split ?? null)
    }
    return out
  }, [visibleKeys])

  // Requêtes exécutées : colonne simple visible ; colonne éclatée dont une sous-colonne est visible,
  // ou toute colonne éclatée applicable quand `discover` (panneau ⚙️ ouvert, GH126).
  const toRun = useMemo(() => applicable.filter(({ query, column }) => {
    const shown = visibleByQuery.get(query.id)
    if (!column.splitColumn) return !!shown?.has(null)
    return discover || (!!shown && [...shown].some((s) => s !== null))
  }).map(({ query }) => query), [applicable, visibleByQuery, discover])

  const runs = useQueries({
    queries: toRun.map((q) => ({
      ...runOptions(projectRepoPath, workspaceDir, username, { queryId: q.id }),
      // Le script fait partie de la clé : une requête modifiée est réexécutée.
      queryKey: ['widget-query-result', projectRepoPath, workspaceDir, username, 'column', q.id, q.script],
    })),
  })
  // `useQueries` renvoie un nouveau tableau à chaque rendu : la signature des données sert de clé.
  const runsSig = runs.map((r) => `${r.dataUpdatedAt}:${r.errorUpdatedAt}:${r.isPending ? 'p' : 'd'}`).join('|')

  // Résultats analysés, une fois par résultat reçu (pas à chaque bascule de champ) : valeurs d'une
  // colonne simple, sous-colonnes d'une colonne éclatée ; chargement ou erreur.
  const parsed = useMemo(() => {
    const runOf = new Map(toRun.map((q, i) => [q.id, runs[i]]))
    const out = new Map<string, ParsedRun>()
    for (const { query, column } of applicable) {
      const r = runOf.get(query.id)
      if (!r) continue
      const data = r.data as ScriptRunResult | undefined
      const runError = !data
        ? (r.error instanceof Error ? r.error.message : r.error ? String(r.error) : undefined)
        : !data.ok ? scriptErrorText(data.error) : undefined
      const pending = !data && !!r.isPending
      if (!column.splitColumn) {
        const fromRows = data?.ok ? columnValuesFromRows(data.rows, column) : null
        const error = runError ?? fromRows?.error
        out.set(query.id, { pending, ...(error ? { error } : {}), values: fromRows && !fromRows.error ? fromRows.values : EMPTY_VALUES })
        continue
      }
      const split = data?.ok ? splitColumnValuesFromRows(data.rows, column) : null
      const error = runError ?? split?.error
      if (split && !split.error) {
        lastKnownSplits.set(splitMemoKey(projectRepoPath, query.id), split.columns.map((s) => ({ value: s.split, label: s.label })))
        out.set(query.id, { pending: false, split: split.columns })
      } else {
        out.set(query.id, { pending, ...(error ? { error } : {}) })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicable, toRun, projectRepoPath, runsSig])

  // Colonnes déployées (une colonne éclatée → ses sous-colonnes) selon la visibilité courante.
  const { available, panel, results } = useMemo(() => {
    const results = new Map<string, ComputedColumnResult>()
    const entries: { label: string; entry: ComputedColumnPanelEntry; columns: ComputedColumn[] }[] = []
    for (const { query, column } of applicable) {
      const label = columnLabel(column, locale)
      const p = parsed.get(query.id)

      if (!column.splitColumn) {
        const c: ComputedColumn = {
          key: computedColumnKey(query.id), queryId: query.id, label, queryTitle: query.title,
          fieldDef: columnFieldDef(query.id, column, locale), headerTitle: `${query.id} — ${query.title}`,
        }
        if (p) results.set(c.key, { values: p.values ?? EMPTY_VALUES, pending: p.pending, ...(p.error ? { error: p.error } : {}) })
        entries.push({ label, entry: { kind: 'column', column: c }, columns: [c] })
        continue
      }

      const sub = (value: string, subLabel: string): ComputedColumn => ({
        key: computedColumnKey(query.id, value), queryId: query.id, label: subLabel, queryTitle: query.title,
        fieldDef: columnFieldDef(query.id, column, locale, { value, label: subLabel }),
        headerTitle: `${label} — ${subLabel}`, split: { value, groupLabel: label },
      })
      let columns: ComputedColumn[]
      if (p?.split) {
        columns = p.split.map((s) => {
          const c = sub(s.split, s.label)
          results.set(c.key, { values: s.values, pending: false })
          return c
        })
      } else {
        // Pas encore de résultat, ou erreur : les sous-colonnes visibles restent affichées (en
        // chargement ou avec ⚠), sans saut de mise en page, et décochables dans ⚙️. D'après le
        // dernier résultat valide de la session s'il est connu (libellés, sous-colonnes disparues
        // écartées), sinon libellé provisoire = la valeur.
        const shown = new Set([...(visibleByQuery.get(query.id) ?? [])].filter((s): s is string => s !== null))
        const known = lastKnownSplits.get(splitMemoKey(projectRepoPath, query.id))
        const standIns = known ? known.filter((k) => shown.has(k.value)) : [...shown].map((value) => ({ value, label: value }))
        columns = standIns.map(({ value, label: subLabel }) => {
          const c = sub(value, subLabel)
          results.set(c.key, { values: EMPTY_VALUES, pending: !!p?.pending, ...(p?.error ? { error: p.error } : {}) })
          return c
        })
      }
      entries.push({
        label,
        entry: { kind: 'group', queryId: query.id, label, queryTitle: query.title, pending: !!p?.pending, ...(p?.error ? { error: p.error } : {}), columns },
        columns,
      })
    }
    entries.sort((a, b) => a.label.localeCompare(b.label))
    return { available: entries.flatMap((e) => e.columns), panel: entries.map((e) => e.entry), results }
  }, [applicable, parsed, visibleByQuery, locale, projectRepoPath])

  // Seules les colonnes visibles sont fusionnées : une sous-colonne exécutée pour le seul panneau ⚙️
  // (`discover`) ne doit pas peser sur le filtre global, qui lit toutes les valeurs des objets.
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys])
  const merge = useCallback(<T extends Record<string, string>>(objects: T[]): T[] => {
    const shown = [...results].filter(([key]) => visibleSet.has(key))
    if (shown.length === 0) return objects
    return objects.map((o) => {
      const extra: Record<string, string> = {}
      for (const [key, res] of shown) extra[key] = res.values.get(o.id)?.value ?? ''
      return { ...o, ...extra }
    })
  }, [results, visibleSet])

  const pending = [...results.values()].some((r) => r.pending)
  // Projet introuvable ou liste en échec : rien à attendre (l'impression ne doit pas rester bloquée).
  const ready = !enabled || !workspaceDir || projectFailed || queriesFailed || (queriesLoaded && !pending)

  const columnsMap = useMemo(() => new Map(available.map((c) => [c.key, { column: c, result: results.get(c.key) }])), [available, results])
  const exportColumns = useMemo(() => new Map(available.map((c) => [c.key, { label: c.label, type: c.fieldDef.type }])), [available])
  const filterFields = useCallback((fields: string[]) => fields.filter((f) => !isComputedColumnKey(f) || columnsMap.has(f)), [columnsMap])
  return { available, panel, results, pending, ready, merge, projectRepoPath, columnsMap, exportColumns, filterFields }
}
