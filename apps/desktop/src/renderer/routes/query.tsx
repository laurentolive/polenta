/**
 * QueryPage — "Vue Requêtes" (T77 sprint 1).
 *
 * Builder / SQL avancé toggle, table de résultat, sauvegarde (titre + portée),
 * liste "Historique" (filtrable, purge auto + croix de suppression), export Excel.
 * GH14 : la liste "Requêtes sauvegardées" a été retirée — elle doublonnait la
 * section Requêtes du panneau latéral Suivi (seul point d'ouverture/suppression).
 *
 * URL: /query?projectId=<encoded>&queryId=<id?>
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Save, Search as SearchIcon } from 'lucide-react'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useWorkspaceStructure } from '../hooks/useWorkspaceStructure'
import { QueryBuilder } from '../components/dashboard/QueryBuilder'
import { SqlEditor } from '../components/dashboard/SqlEditor'
import { ResultTable } from '../components/dashboard/ResultTable'
import { ViewHeader } from '../components/layout/ViewHeader'
import { ExportButton } from '../components/export/ExportButton'
import { queryResultExportBaseName } from '../components/export/exportFilenames'
import { useSetTabTitle } from '../contexts/TabsContext'
import { useModalHotkeys } from '../hooks/useModalHotkeys'
import type { BuilderConfig, QueryDefinition, QueryMode, QueryResult, QueryScope, SavedQuery, QueryHistoryEntry } from '@polenta/types'

export const Route = createFileRoute('/query')({
  component: QueryPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    queryId: (s['queryId'] as string | undefined) ?? undefined,
  }),
})

const EMPTY_BUILDER_CONFIG: BuilderConfig = { objectTypeRef: '', conditions: [], combinator: 'AND' }

function entryFilterText(mode: QueryMode, builderConfig: BuilderConfig | undefined, sqlText: string | undefined): string {
  const content = mode === 'sql' ? (sqlText ?? '') : JSON.stringify(builderConfig ?? {})
  return content.toLowerCase()
}

function QueryPage() {
  const { t } = useTranslation()
  const { projectId, queryId } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const workspaceDir = decodeProjectId(projectId)

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''

  const { data: identity } = useQuery({
    queryKey: ['identity', repoPath],
    queryFn: () => api.auth.resolveIdentity(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = identity?.login ?? 'local'

  // Types across every workspace component (not just root, T93) — the query-engine
  // dataset already aggregates all of them, the picker needs to match.
  const { flatNodes, schemasByRepoPath } = useWorkspaceStructure(workspaceDir, repoPath)

  const { data: savedQueries = [] } = useQuery({
    queryKey: ['queries', repoPath, username],
    queryFn: () => api.queries.list(repoPath, username),
    enabled: !!repoPath && !!username,
  })
  // Only a saved query has a stable name worth showing on the tab — an ad hoc/history-only
  // query has none, so the tab keeps the generic "Requêtes" default in that case.
  useSetTabTitle(queryId ? savedQueries.find(q => q.id === queryId)?.title : undefined)

  const { data: history = [] } = useQuery({
    queryKey: ['queries-history', repoPath, username],
    queryFn: () => api.queries.historyList(repoPath, username),
    enabled: !!repoPath && !!username,
  })

  // ── Editor state ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<QueryMode>('builder')
  const [builderConfig, setBuilderConfig] = useState<BuilderConfig>(EMPTY_BUILDER_CONFIG)
  const [sqlText, setSqlText] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [saveModal, setSaveModal] = useState<{ title: string; scope: QueryScope } | null>(null)
  const [historyFilter, setHistoryFilter] = useState('')

  const loadedRef = useRef<string | undefined>(undefined)
  // Identifie la requête d'exécution "actuelle" — incrémenté à chaque nouvel appel et à
  // chaque reset (bouton "Ajouter"). Une réponse dont l'id ne correspond plus au dernier
  // émis est ignorée : sans ce garde-fou, ouvrir une requête lente puis en rouvrir une
  // autre avant qu'elle ne réponde ferait écraser le résultat/l'éditeur affichés par une
  // réponse périmée qui arrive après coup.
  const requestIdRef = useRef(0)

  async function runQueryDef(def: QueryDefinition) {
    const reqId = ++requestIdRef.current
    setIsExecuting(true)
    try {
      const res = await api.queries.execute(repoPath, def, workspaceDir)
      if (requestIdRef.current !== reqId) return
      setResult(res)
      setError(null)
      api.queries
        .historyAdd(repoPath, username, { mode: def.mode, builderConfig: def.builderConfig, sqlText: def.sqlText })
        .then(() => qc.invalidateQueries({ queryKey: ['queries-history', repoPath, username] }))
        .catch(() => { /* l'historique est un confort, pas une garantie — on n'échoue pas la requête pour ça */ })
    } catch (err) {
      if (requestIdRef.current !== reqId) return
      // Pas de résultat périmé laissé à l'écran sans indication (T77-tests.md cas limite).
      setResult(null)
      setError(err instanceof Error ? err.message : t('dashboard.widgetModal.queryExecutionError'))
    } finally {
      if (requestIdRef.current === reqId) setIsExecuting(false)
    }
  }

  function runCurrent() {
    if (mode === 'builder') {
      if (!builderConfig.objectTypeRef) return
      void runQueryDef({ mode: 'builder', builderConfig })
    } else {
      if (!sqlText.trim()) return
      void runQueryDef({ mode: 'sql', sqlText })
    }
  }

  function loadEntry(entryMode: QueryMode, entryBuilderConfig?: BuilderConfig, entrySqlText?: string) {
    setMode(entryMode)
    if (entryMode === 'builder') {
      const cfg = entryBuilderConfig ?? EMPTY_BUILDER_CONFIG
      setBuilderConfig(cfg)
      setSqlText('')
      if (cfg.objectTypeRef) void runQueryDef({ mode: 'builder', builderConfig: cfg })
    } else {
      const sql = entrySqlText ?? ''
      setSqlText(sql)
      setBuilderConfig(EMPTY_BUILDER_CONFIG)
      if (sql.trim()) void runQueryDef({ mode: 'sql', sqlText: sql })
    }
  }

  // Reset the editor to a blank query when navigating to "Ajouter" (queryId absent).
  useEffect(() => {
    if (queryId) return
    loadedRef.current = undefined
    requestIdRef.current++ // invalide toute exécution en cours pour la requête précédente
    setMode('builder')
    setBuilderConfig(EMPTY_BUILDER_CONFIG)
    setSqlText('')
    setResult(null)
    setError(null)
  }, [queryId])

  // Load a saved query or a history entry into the editor when queryId points at one.
  useEffect(() => {
    if (!queryId || loadedRef.current === queryId) return
    const found: SavedQuery | QueryHistoryEntry | undefined =
      savedQueries.find((q) => q.id === queryId) ?? history.find((h) => h.id === queryId)
    if (!found) return
    loadedRef.current = queryId
    loadEntry(found.mode, found.builderConfig, found.sqlText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryId, savedQueries, history])

  async function switchToSql() {
    if (mode === 'builder' && builderConfig.objectTypeRef && repoPath) {
      try {
        const generated = await api.queries.builderToSql(repoPath, builderConfig, workspaceDir)
        setSqlText(generated)
      } catch {
        // Le builder est incomplet ou invalide — l'utilisateur repart d'un éditeur vide.
      }
    }
    setMode('sql')
  }

  const createMutation = useMutation({
    mutationFn: (dto: Parameters<typeof api.queries.create>[2]) => api.queries.create(repoPath, username, dto),
    onSuccess: (q) => {
      setSaveModal(null)
      qc.invalidateQueries({ queryKey: ['queries', repoPath, username] })
      navigate({ to: '/query', search: { projectId, queryId: q.id } })
    },
  })

  function confirmSave() {
    if (!saveModal || !saveModal.title.trim()) return
    createMutation.mutate({
      title: saveModal.title.trim(),
      mode,
      builderConfig: mode === 'builder' ? builderConfig : undefined,
      sqlText: mode === 'sql' ? sqlText : undefined,
      scope: saveModal.scope,
      createdBy: username,
    })
  }

  useModalHotkeys(() => setSaveModal(null), confirmSave, !saveModal || createMutation.isPending)

  const deleteHistoryMutation = useMutation({
    mutationFn: (id: string) => api.queries.historyDelete(repoPath, username, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries-history', repoPath, username] }),
  })

  // Nom de la requête sauvegardée actuellement chargée, sinon nom générique — cf. specs/T43.md §4
  // (pattern `request-{name}`). `QueryHistoryEntry` n'a pas de titre (requête non sauvegardée) :
  // seule une requête réellement sauvegardée (`savedQueries`) peut fournir un nom.
  const currentQueryName = (queryId && savedQueries.find(q => q.id === queryId)?.title) || 'resultat'

  const visibleHistory = historyFilter.trim()
    ? history.filter((h) => entryFilterText(h.mode, h.builderConfig, h.sqlText).includes(historyFilter.trim().toLowerCase()))
    : history

  if (!projectId) return <p className="text-sm text-ink-3 p-4">{t('common.projectNotLoaded')}</p>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={t('sidebar.dashboard.queriesTab')}
        actions={
          result && (
            <ExportButton
              kind="query-result"
              formats={['xlsx', 'pdf']}
              repoPath={repoPath}
              getSuggestedBaseName={() => queryResultExportBaseName(currentQueryName)}
              getPayload={() => ({ queryName: currentQueryName, result })}
              getPrintParams={() => {
                const resultJson = JSON.stringify(result)
                // Le résultat complet transite en JSON dans l'URL de la fenêtre cachée
                // (`pdf.util.ts` → `win.loadFile(..., {search})`) faute d'ID stable à recharger
                // pour une requête ad hoc — cf. `QueryResultExportPayload`. Au-delà d'un certain
                // volume, la chaîne de requête risque une troncature silencieuse (constat de
                // revue de code) plutôt qu'une erreur claire : on préfère refuser explicitement
                // l'export PDF et orienter vers Excel, qui n'a pas cette limite.
                if (resultJson.length > 200_000) {
                  throw new Error(t('queryPage.resultTooLargeForPdf'))
                }
                return { queryName: currentQueryName, resultJson }
              }}
            />
          )
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl p-6 pb-16 space-y-6">
      {/* ── Editeur ── */}
      <div className="bg-surface border border-edge rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-edge overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setMode('builder')}
              className={`px-3 py-1.5 ${mode === 'builder' ? 'bg-status-info-solid text-status-info-fg' : 'text-ink-2 hover:bg-hover'}`}
            >
              {t('queryPage.builderMode')}
            </button>
            <button
              type="button"
              onClick={switchToSql}
              className={`px-3 py-1.5 ${mode === 'sql' ? 'bg-status-info-solid text-status-info-fg' : 'text-ink-2 hover:bg-hover'}`}
            >
              {t('queryPage.sqlMode')}
            </button>
          </div>

          <div className="flex-1" />

          <button
            type="button"
            onClick={runCurrent}
            disabled={isExecuting}
            className="btn-primary-sm flex items-center gap-1.5"
          >
            <Play size={12} />
            {isExecuting ? t('queryPage.executing') : t('queryPage.execute')}
          </button>
          <button
            type="button"
            onClick={() => setSaveModal({ title: '', scope: 'private' })}
            className="btn-secondary-sm flex items-center gap-1.5"
          >
            <Save size={12} />
            {t('requirementsPage.save')}
          </button>
        </div>

        {mode === 'builder' ? (
          <QueryBuilder
            flatNodes={flatNodes}
            schemasByRepoPath={schemasByRepoPath}
            selfRepoPath={repoPath}
            value={builderConfig}
            onChange={setBuilderConfig}
          />
        ) : (
          <SqlEditor value={sqlText} onChange={setSqlText} />
        )}

        {error && (
          <p className="text-xs text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">
            {error}
          </p>
        )}

        <ResultTable result={result} />
      </div>

      {/* ── Historique ── */}
      <div className="bg-surface border border-edge rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-edge flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide shrink-0">
            {historyFilter
              ? t('queryPage.historyCountFiltered', { visible: visibleHistory.length, total: history.length })
              : t('queryPage.historyCount', { count: visibleHistory.length })}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-edge-subtle">
          <SearchIcon size={11} className="text-ink-3 shrink-0" />
          <input
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            placeholder={t('common.filterPlaceholder')}
            className="flex-1 text-xs bg-transparent text-ink border-0 outline-none placeholder:text-ink-3"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-xs text-ink-3 italic px-4 py-4">{t('queryPage.noHistory')}</p>
          ) : visibleHistory.length === 0 ? (
            <p className="text-xs text-ink-3 italic px-4 py-4">{t('queryPage.noResultForFilter')}</p>
          ) : (
            visibleHistory.map((h) => (
              <div key={h.id} className="group flex items-center gap-2 px-4 py-2 hover:bg-hover border-b border-edge-subtle last:border-0">
                <button type="button" onClick={() => navigate({ to: '/query', search: { projectId, queryId: h.id } })} className="flex-1 flex items-center gap-2 text-left min-w-0">
                  <span className="text-[10px] font-mono text-ink-3 shrink-0 uppercase">{h.mode}</span>
                  <span className="text-xs text-ink truncate">
                    {h.mode === 'sql' ? h.sqlText : h.builderConfig?.objectTypeRef}
                  </span>
                </button>
                <span className="text-[10px] text-ink-3 shrink-0">{new Date(h.executedAt).toLocaleTimeString()}</span>
                <button
                  type="button"
                  onClick={() => deleteHistoryMutation.mutate(h.id)}
                  className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-status-danger transition-opacity shrink-0"
                  title={t('common.delete')}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Modal de sauvegarde ── */}
      {saveModal && (
        <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-20">
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="font-semibold text-sm text-ink mb-4">{t('queryPage.saveQueryTitle')}</h2>
            <label className="text-xs text-ink-3 block mb-1">{t('requirementsPage.titleLabel')}</label>
            <input
              value={saveModal.title}
              onChange={(e) => setSaveModal({ ...saveModal, title: e.target.value })}
              placeholder={t('queryPage.queryTitlePlaceholder')}
              autoFocus
              className="input-field w-full mb-4"
            />
            <label className="text-xs text-ink-3 block mb-1.5">{t('queryPage.scopeLabel')}</label>
            <div className="flex gap-4 mb-5">
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input
                  type="radio"
                  checked={saveModal.scope === 'private'}
                  onChange={() => setSaveModal({ ...saveModal, scope: 'private' })}
                />
                {t('queryPage.scopePrivate')}
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input
                  type="radio"
                  checked={saveModal.scope === 'shared'}
                  onChange={() => setSaveModal({ ...saveModal, scope: 'shared' })}
                />
                {t('queryPage.scopeShared')}
              </label>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setSaveModal(null)} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmSave}
                disabled={!saveModal.title.trim() || createMutation.isPending}
                className="btn-primary"
              >
                {createMutation.isPending ? t('requirementsPage.saving') : t('requirementsPage.save')}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      </div>
    </div>
  )
}
