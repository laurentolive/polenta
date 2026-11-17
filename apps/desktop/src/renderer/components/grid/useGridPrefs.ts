import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FieldVisibilityPatch, FieldVisibilityPref } from '@polenta/api-client'
import type { SavedViewRef } from '@polenta/types'
import { api } from '../../api'

/** Grille rattachée au `.pref` d'un repo (`prefKey` : type ou `grid::<id>`, `view` : clé des colonnes). */
export interface RepoGridPrefs {
  repoPath: string
  prefKey: string
  view: string
  defaults: string[]
}
/** Grille sans préférence enregistrée (état local, oublié au démontage). */
export interface LocalGridPrefs {
  local: true
  defaults: string[]
}
export type GridPrefsSource = RepoGridPrefs | LocalGridPrefs

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** Clés de `FieldVisibilityPref` d'une vue : colonnes `<view>`, largeurs `colWidths<View>`, gel `freezeColCount<View>`. */
export const gridPrefKeys = (view: string) => ({ columns: view, widths: `colWidths${cap(view)}`, freeze: `freezeColCount${cap(view)}` })

type Entry = Record<string, unknown>
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string')
const EMPTY_WIDTHS: Record<string, number> = {}

export interface GridPrefs {
  /** Préférences lues (ou grille locale). */
  loaded: boolean
  /** Utilisateur du `.pref` (vues enregistrées). */
  username: string
  /** Colonnes visibles ordonnées, telles qu'enregistrées (clés inconnues comprises, jamais réécrites d'elles-mêmes). */
  columns: string[]
  widths: Record<string, number>
  freezeCount: number
  activeView: SavedViewRef | null
  setColumns(next: string[]): void
  setWidths(next: Record<string, number>): void
  setFreezeCount(next: number): void
  /** Vue enregistrée appliquée (colonnes copiées dans la préférence) ou oubliée (`null`). */
  applyView(columns: string[], ref: SavedViewRef | null): void
  setActiveView(ref: SavedViewRef | null): Promise<void>
  /** Retour aux colonnes par défaut (clés retirées du `.pref`). */
  reset(): void
  /** Entrée brute du `.pref` (autres clés d'un même type : vue système, sélecteur), `null` si absente. */
  raw: Readonly<Record<string, unknown>> | null
  /** Écriture partielle d'autres clés (`null` supprime), avec la même mise à jour optimiste. */
  patch(patch: FieldVisibilityPatch): Promise<void>
}

/**
 * GH389 — préférences de colonnes d'une grille, par utilisateur, dans le `.pref` du repo affiché
 * (lecture / écriture partielle GH176, mise à jour optimiste du cache partagé), ou locales. Les
 * filtres ne passent jamais par ici. Les fonctions rendues sont stables (props de grilles mémoïsées).
 */
export function useGridPrefs(source: GridPrefsSource): GridPrefs {
  const local = 'local' in source
  const repoPath = local ? '' : source.repoPath
  const prefKey = local ? '' : source.prefKey
  const keys = gridPrefKeys(local ? 'local' : source.view)
  const qc = useQueryClient()

  const { data: login, isPending: loginPending } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = login ?? 'local'
  const queryKey = useMemo(() => ['pref-visibility', repoPath, username, prefKey], [repoPath, username, prefKey])
  const { data: pref, isSuccess } = useQuery({
    queryKey,
    queryFn: (): Promise<FieldVisibilityPref | null> => api.pref.getFieldVisibility(repoPath, username, prefKey),
    enabled: !!repoPath && !!prefKey && !loginPending,
  })
  const entry = (pref ?? null) as Entry | null

  const [localState, setLocalState] = useState<{ columns?: string[]; widths?: Record<string, number>; freeze?: number }>({})

  const save = useCallback((patch: FieldVisibilityPatch | Entry) => {
    if (local || !repoPath || !prefKey) return Promise.resolve()
    // Une relecture en cours ramènerait la valeur d'avant ce changement.
    void qc.cancelQueries({ queryKey })
    qc.setQueryData<Entry | null>(queryKey, prev => {
      const next: Entry = { ...prev }
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k]
        else if (v !== undefined) next[k] = v
      }
      return next
    })
    return api.pref.setFieldVisibility(repoPath, username, prefKey, patch as FieldVisibilityPatch)
      .catch(err => console.error(`[useGridPrefs] ${prefKey} :`, err))
      .finally(() => { void qc.invalidateQueries({ queryKey }) })
  }, [local, qc, queryKey, repoPath, username, prefKey])

  const storedColumns = local ? localState.columns : entry?.[keys.columns]
  const storedWidths = local ? localState.widths : entry?.[keys.widths]
  const storedFreeze = local ? localState.freeze : entry?.[keys.freeze]
  const columns = useMemo(() => (isStringList(storedColumns) ? storedColumns : source.defaults), [storedColumns, source.defaults])
  const widths = storedWidths && typeof storedWidths === 'object' ? storedWidths as Record<string, number> : EMPTY_WIDTHS
  const freezeCount = typeof storedFreeze === 'number' ? storedFreeze : 0

  const latest = useRef({ local, save, keys })
  latest.current = { local, save, keys }
  const actions = useMemo(() => {
    const write = (localPatch: { columns?: string[]; widths?: Record<string, number>; freeze?: number }, patch: (k: typeof keys) => Entry) => {
      const { local: isLocal, save: doSave, keys: k } = latest.current
      if (isLocal) setLocalState(s => ({ ...s, ...localPatch }))
      else void doSave(patch(k))
    }
    return {
      setColumns: (next: string[]) => write({ columns: next }, k => ({ [k.columns]: next })),
      setWidths: (next: Record<string, number>) => write({ widths: next }, k => ({ [k.widths]: next })),
      setFreezeCount: (next: number) => write({ freeze: next }, k => ({ [k.freeze]: next || null })),
      applyView: (next: string[], ref: SavedViewRef | null) => write({ columns: next }, k => ({ [k.columns]: next, activeView: ref })),
      setActiveView: (ref: SavedViewRef | null) => latest.current.save({ activeView: ref }),
      reset: () => write({ columns: undefined }, k => ({ [k.columns]: null, activeView: null })),
      patch: (patch: FieldVisibilityPatch) => latest.current.save(patch),
    }
  }, [])

  return {
    loaded: local || isSuccess,
    username,
    columns,
    widths,
    freezeCount,
    activeView: (entry?.activeView as SavedViewRef | undefined) ?? null,
    raw: entry,
    ...actions,
  }
}
