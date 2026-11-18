import { useMemo, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'
import type { ColumnFilters } from '../components/grid/columnFilters'
import { ExecutionDocument } from '../components/executions/ExecutionDocument'
import { buildExecutionColumns, type ExecutionGestures } from '../components/executions/executionColumnDefs'
import { defaultRunWordColumns } from '../components/executions/executionColumns'

/** Paramètre JSON de `printParams` ; illisible : valeur de repli. */
function parseJson<T>(raw: string, fallback: T): T {
  try { return raw ? JSON.parse(raw) as T : fallback } catch { return fallback }
}

const INERT_GESTURES: ExecutionGestures = { open: () => {}, openVersion: () => {} }

/**
 * GH400 — PDF du Document de la vue Exécutions (specs/GH400-design.md §10) : relit l'historique du
 * type et la préférence `runWord`, applique les filtres du Tableau transmis par la vue.
 */
export const Route = createFileRoute('/print/executions')({
  component: PrintExecutionsPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    username: (s['username'] as string) ?? 'local',
    objectTypeRef: (s['objectTypeRef'] as string) ?? '',
    workspaceDir: (s['workspaceDir'] as string) ?? '',
    title: (s['title'] as string) ?? '',
    filters: (s['filters'] as string) ?? '',
    filterKeys: (s['filterKeys'] as string) ?? '',
  }),
})

function PrintExecutionsPage() {
  const { t, i18n } = useTranslation()
  const { repoPath, username, objectTypeRef, workspaceDir, title, filters: rawFilters, filterKeys: rawKeys } = Route.useSearch()
  const target = useMemo(() => ({ objectTypeRef }), [objectTypeRef])

  const { data: history, isSuccess: historyLoaded } = useQuery({
    queryKey: ['print-executions', repoPath, objectTypeRef, workspaceDir],
    queryFn: () => api.executions.history(repoPath, target, workspaceDir || undefined),
    enabled: !!repoPath && !!objectTypeRef,
  })
  const { data: prefs, isSuccess: prefsLoaded } = useQuery({
    queryKey: ['print-prefs', repoPath, username, objectTypeRef],
    queryFn: () => api.pref.getFieldVisibility(repoPath, username, objectTypeRef),
    enabled: !!repoPath && !!objectTypeRef,
  })
  useNotifyPrintReady(historyLoaded && prefsLoaded)

  const gestures = useRef(INERT_GESTURES)
  const columns = useMemo(
    () => (history ? buildExecutionColumns({ history, withTestColumn: true, t, language: i18n.language, repoPath, gestures, print: true }) : []),
    [history, t, i18n.language, repoPath],
  )
  const filters = useMemo(() => parseJson<ColumnFilters>(rawFilters, {}), [rawFilters])
  const filterKeys = useMemo(() => parseJson<string[]>(rawKeys, []), [rawKeys])
  if (!history) return null
  const fields = prefs?.runWord ?? defaultRunWordColumns(history)

  return (
    <div className="p-10 bg-print-bg text-print-ink text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-6">{title}</h1>
      <ExecutionDocument history={history} columns={columns} repoPath={repoPath} fields={fields} filters={filters} filterKeys={filterKeys} print />
    </div>
  )
}
