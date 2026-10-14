/**
 * QueryPage — « Vue Requêtes » de la vue Suivi (T77 ; GH74 : scripts de données).
 *
 * Deux modes : **Modèle** (formulaire d'un modèle de requête, le script est généré) et **Script**
 * (éditeur JS, `export default (data, polenta) => rows`). Exécution dans le bac à sable du main,
 * table des lignes ou erreur (message, fichier, ligne), enregistrement (mise à jour de la requête
 * ouverte, ou « Enregistrer sous » : titre + portée), historique privé, export Excel / PDF.
 * Une requête SQL d'avant GH74 s'affiche en lecture seule (non prise en charge).
 *
 * URL: /query?projectId=<encoded>&queryId=<id?>
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Play, Save, Search as SearchIcon } from 'lucide-react'
import type { QueryResult, QueryScope, ScriptRunResult } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ResultTable } from '../components/dashboard/ResultTable'
import { CodeEditor } from '../components/dashboard/CodeEditor'
import { TemplateForm } from '../components/dashboard/TemplateForm'
import { ViewHeader } from '../components/layout/ViewHeader'
import { ExportButton } from '../components/export/ExportButton'
import { queryResultExportBaseName } from '../components/export/exportFilenames'
import { useSetTabTitle } from '../contexts/TabsContext'
import { useModalHotkeys } from '../hooks/useModalHotkeys'
import { clientInfo, scriptErrorText, toQueryResult } from '../hooks/useScriptRun'
import { filteredListFields, useCampaignOptions, useSuiviObjectTypes, useSuiviTemplates } from '../hooks/useSuiviCatalog'

export const Route = createFileRoute('/query')({
  component: QueryPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    queryId: (s['queryId'] as string | undefined) ?? undefined,
  }),
})

const EMPTY_SCRIPT = `// @polenta contract 1
// Script de données : renvoie un tableau de lignes. Types : dashboards/lib/polenta.d.ts.
export default function (data, polenta) {
  return data.requirements.map((r) => ({ id: r.id, title: r.title, status: r.status, _ids: [r.id] }))
}
`

function QueryPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'fr'
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

  const { data: identityLogin, isError: identityError } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  // GH29 — vide tant que l'identité n'est pas résolue : rien n'est lu ni écrit sous `local` par erreur.
  const username = identityLogin ?? (identityError ? 'local' : '')

  const { data: catalog } = useSuiviTemplates()
  const { data: objectTypes = [] } = useSuiviObjectTypes(repoPath, workspaceDir)
  const { data: campaigns = [] } = useCampaignOptions(repoPath)

  const { data: savedQueries = [] } = useQuery({
    queryKey: ['queries', repoPath, username],
    queryFn: () => api.queries.list(repoPath, username),
    enabled: !!repoPath && !!username,
  })
  const current = queryId ? savedQueries.find((q) => q.id === queryId) : undefined
  useSetTabTitle(current?.title)

  const { data: history = [] } = useQuery({
    queryKey: ['queries-history', repoPath, username],
    queryFn: () => api.queries.historyList(repoPath, username),
    enabled: !!repoPath && !!username,
  })

  // ── Éditeur ───────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'template' | 'script'>('template')
  const [templateId, setTemplateId] = useState('filtered-list')
  const [params, setParams] = useState<Record<string, unknown>>({ category: 'requirement' })
  const [script, setScript] = useState(EMPTY_SCRIPT)
  /** Texte du script tel que chargé ou généré : différent → modifié à la main (repasser au modèle
   *  le perd : confirmation). Comparé plutôt que suivi par `onChange`, que l'éditeur émet aussi
   *  quand sa valeur change de l'extérieur. */
  const [scriptBaseline, setScriptBaseline] = useState(EMPTY_SCRIPT)
  const scriptEdited = script !== scriptBaseline
  const [confirmTemplate, setConfirmTemplate] = useState(false)
  const [run, setRun] = useState<ScriptRunResult | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [saveModal, setSaveModal] = useState<{ title: string; scope: QueryScope } | null>(null)
  const [historyFilter, setHistoryFilter] = useState('')
  const loadedRef = useRef<string | undefined>(undefined)
  // Une réponse dont l'id n'est plus le dernier émis (autre requête ouverte entre-temps) est ignorée.
  const requestIdRef = useRef(0)

  const template = catalog?.queries.find((q) => q.id === templateId)
  const readOnly = current?.state.readOnly

  /** Script à exécuter / enregistrer : généré par le modèle, ou celui de l'éditeur. */
  async function currentScript(): Promise<string> {
    if (mode === 'script') return script
    return (await api.suivi.renderTemplate('query', { id: templateId, params })).script
  }

  async function execute(code?: string) {
    if (!repoPath || !username) return
    const reqId = ++requestIdRef.current
    setIsExecuting(true)
    try {
      const text = code ?? await currentScript()
      const res = await api.suivi.run(repoPath, workspaceDir, username, { script: text }, clientInfo())
      if (requestIdRef.current !== reqId) return
      setRun(res)
      if (res.ok) {
        api.queries.historyAdd(repoPath, username, { script: text })
          .then(() => qc.invalidateQueries({ queryKey: ['queries-history', repoPath, username] }))
          .catch(() => { /* l'historique est un confort, pas une garantie */ })
      }
    } catch (err) {
      if (requestIdRef.current !== reqId) return
      setRun({ ok: false, error: { kind: 'runtime', message: err instanceof Error ? err.message : String(err), file: null, line: null, column: null } })
    } finally {
      if (requestIdRef.current === reqId) setIsExecuting(false)
    }
  }

  // « Ajouter » (queryId absent) : éditeur vierge.
  useEffect(() => {
    if (queryId) return
    loadedRef.current = undefined
    requestIdRef.current++
    setMode('template')
    setTemplateId('filtered-list')
    setParams({ category: 'requirement' })
    setScript(EMPTY_SCRIPT)
    setScriptBaseline(EMPTY_SCRIPT)
    setConfirmTemplate(false)
    setRun(null)
  }, [queryId])

  // Requête enregistrée ou entrée d'historique désignée par l'URL : chargée puis exécutée.
  useEffect(() => {
    if (!queryId || loadedRef.current === queryId) return
    const saved = savedQueries.find((q) => q.id === queryId)
    const hist = history.find((h) => h.id === queryId)
    if (!saved && !hist) return
    loadedRef.current = queryId
    setRun(null)
    if (saved?.state.readOnly === 'legacy-sql') return
    if (saved?.template && !saved.state.customized) {
      setMode('template')
      setTemplateId(saved.template.id)
      setParams(saved.template.params)
    } else {
      setMode('script')
    }
    const text = saved?.script ?? hist!.script
    setScript(text)
    setScriptBaseline(text)
    setConfirmTemplate(false)
    void execute(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryId, savedQueries, history])

  const invalidateQueries = () => qc.invalidateQueries({ queryKey: ['queries', repoPath, username] })

  const createMutation = useMutation({
    mutationFn: async (dto: { title: string; scope: QueryScope }) =>
      api.queries.create(repoPath, username, {
        ...dto, createdBy: username,
        ...(mode === 'template' ? { template: { id: templateId, params } } : { script }),
      }),
    onSuccess: (q) => {
      setSaveModal(null)
      invalidateQueries()
      loadedRef.current = q.id
      navigate({ to: '/query', search: { projectId, queryId: q.id } })
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => api.queries.update(repoPath, username, current!.id, mode === 'template' ? { template: { id: templateId, params } } : { script }),
    onSuccess: () => {
      invalidateQueries()
      // Les widgets qui utilisent cette requête sont réexécutés (leur clé porte le script) ; une
      // requête de seed modifiée n'est plus proposée au bandeau des mises à jour.
      qc.invalidateQueries({ queryKey: ['widget-query-result'] })
      qc.invalidateQueries({ queryKey: ['suivi-updates'] })
    },
  })

  function confirmSave() {
    if (!saveModal || !saveModal.title.trim()) return
    createMutation.mutate({ title: saveModal.title.trim(), scope: saveModal.scope })
  }
  useModalHotkeys(() => setSaveModal(null), confirmSave, !saveModal || createMutation.isPending)

  const deleteHistoryMutation = useMutation({
    mutationFn: (id: string) => api.queries.historyDelete(repoPath, username, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries-history', repoPath, username] }),
  })

  const result: QueryResult | null = run ? toQueryResult(run) : null
  const currentQueryName = current?.title || 'resultat'
  const firstLine = (s: string) => s.split('\n').find((l) => l.trim() && !l.trim().startsWith('//'))?.trim() ?? s.slice(0, 60)
  const visibleHistory = historyFilter.trim()
    ? history.filter((h) => h.script.toLowerCase().includes(historyFilter.trim().toLowerCase()))
    : history
  const fieldOptions = templateId === 'filtered-list' ? filteredListFields(params, objectTypes) : (result?.columns.map((c) => c.name) ?? [])

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
                // Le résultat transite en JSON dans l'URL de la fenêtre d'impression : au-delà d'un
                // certain volume, refus explicite plutôt qu'une troncature silencieuse.
                if (resultJson.length > 200_000) throw new Error(t('queryPage.resultTooLargeForPdf'))
                return { queryName: currentQueryName, resultJson }
              }}
            />
          )
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl p-6 pb-16 space-y-6">
          {readOnly === 'legacy-sql' ? (
            <div className="bg-surface border border-edge rounded-lg p-4 space-y-3" data-testid="legacy-sql">
              <p className="flex items-start gap-2 text-xs text-status-warning">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {t('queryPage.legacySqlNotice')}
              </p>
              <pre className="text-xs font-mono bg-canvas border border-edge rounded p-3 whitespace-pre-wrap text-ink-2">{current?.legacySql}</pre>
            </div>
          ) : (
            <div className="bg-surface border border-edge rounded-lg p-4 space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-edge overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      // Code modifié (ou requête personnalisée) : « Revenir au modèle » le perd.
                      if (mode === 'script' && (scriptEdited || current?.state.customized)) setConfirmTemplate(true)
                      else setMode('template')
                    }}
                    className={`px-3 py-1.5 ${mode === 'template' ? 'bg-status-info-solid text-status-info-fg' : 'text-ink-2 hover:bg-hover'}`}
                  >
                    {t('queryPage.templateMode')}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (mode === 'template') {
                        const generated = await currentScript()
                        setScript(generated)
                        setScriptBaseline(generated)
                      }
                      setMode('script')
                    }}
                    className={`px-3 py-1.5 ${mode === 'script' ? 'bg-status-info-solid text-status-info-fg' : 'text-ink-2 hover:bg-hover'}`}
                  >
                    {t('queryPage.scriptMode')}
                  </button>
                </div>
                {current?.state.customized && current.template && mode === 'script' && !confirmTemplate && (
                  <span className="text-[11px] text-ink-3">{t('queryPage.customizedNotice')}</span>
                )}
                {confirmTemplate && (
                  <span className="flex items-center gap-2 text-[11px] text-ink-2" data-testid="revert-confirm">
                    {t('dashboard.widgetModal.revertConfirm')}
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      onClick={() => {
                        if (current?.template) {
                          setTemplateId(current.template.id)
                          setParams(current.template.params)
                        }
                        setConfirmTemplate(false)
                        setMode('template')
                      }}
                    >
                      {t('dashboard.widgetModal.revert')}
                    </button>
                    <button type="button" onClick={() => setConfirmTemplate(false)} className="text-ink-3 hover:text-ink underline">{t('common.cancel')}</button>
                  </span>
                )}
                {readOnly === 'newer-format' && <span className="text-[11px] text-status-warning">{t('queryPage.newerFormatNotice')}</span>}
                <div className="flex-1" />
                <button type="button" onClick={() => void execute()} disabled={isExecuting} className="btn-primary-sm flex items-center gap-1.5">
                  <Play size={12} />
                  {isExecuting ? t('queryPage.executing') : t('queryPage.execute')}
                </button>
                {current && !readOnly && (
                  <button type="button" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="btn-secondary-sm flex items-center gap-1.5">
                    <Save size={12} /> {t('requirementsPage.save')}
                  </button>
                )}
                <button type="button" onClick={() => setSaveModal({ title: current ? `${current.title} (2)` : '', scope: 'private' })} className="btn-secondary-sm flex items-center gap-1.5">
                  <Save size={12} /> {t(current ? 'queryPage.saveAs' : 'requirementsPage.save')}
                </button>
              </div>

              {mode === 'template' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-ink-3 shrink-0 w-40">{t('queryPage.templateLabel')}</label>
                    <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setParams({}) }} className="input-field flex-1 text-xs py-1" aria-label={t('queryPage.templateLabel')}>
                      {(catalog?.queries ?? []).map((q) => <option key={q.id} value={q.id}>{q.label[lang]}</option>)}
                    </select>
                  </div>
                  {template && (
                    <TemplateForm params={template.params} value={params} onChange={setParams} columns={fieldOptions} objectTypes={objectTypes} campaigns={campaigns} />
                  )}
                </div>
              ) : (
                <CodeEditor language="javascript" value={script} onChange={setScript} minHeight={220} ariaLabel={t('queryPage.scriptMode')}
                  errorLine={run && !run.ok && run.error.file === 'script.js' ? run.error.line : null} />
              )}

              {(updateMutation.error || createMutation.error) && (
                <p className="text-xs text-status-danger">{String((updateMutation.error ?? createMutation.error) instanceof Error ? (updateMutation.error ?? createMutation.error as Error).message : '')}</p>
              )}
              {run && !run.ok && (
                <p className="text-xs text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2 whitespace-pre-wrap" data-testid="script-error">
                  {scriptErrorText(run.error)}
                </p>
              )}
              <ResultTable result={result} />
            </div>
          )}

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
              <input value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)} placeholder={t('common.filterPlaceholder')} className="flex-1 text-xs bg-transparent text-ink border-0 outline-none placeholder:text-ink-3" />
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
                      <span className="text-xs font-mono text-ink truncate">{firstLine(h.script)}</span>
                    </button>
                    <span className="text-[10px] text-ink-3 shrink-0">{new Date(h.executedAt).toLocaleTimeString()}</span>
                    <button type="button" onClick={() => deleteHistoryMutation.mutate(h.id)} className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-status-danger transition-opacity shrink-0" title={t('common.delete')}>
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Enregistrer sous ── */}
          {saveModal && (
            <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-20">
              <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
                <h2 className="font-semibold text-sm text-ink mb-4">{t('queryPage.saveQueryTitle')}</h2>
                <label className="text-xs text-ink-3 block mb-1">{t('requirementsPage.titleLabel')}</label>
                <input value={saveModal.title} onChange={(e) => setSaveModal({ ...saveModal, title: e.target.value })} placeholder={t('queryPage.queryTitlePlaceholder')} autoFocus className="input-field w-full mb-4" />
                <label className="text-xs text-ink-3 block mb-1.5">{t('queryPage.scopeLabel')}</label>
                <div className="flex gap-4 mb-5">
                  <label className="flex items-center gap-1.5 text-xs text-ink-2">
                    <input type="radio" checked={saveModal.scope === 'private'} onChange={() => setSaveModal({ ...saveModal, scope: 'private' })} />
                    {t('queryPage.scopePrivate')}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-ink-2">
                    <input type="radio" checked={saveModal.scope === 'shared'} onChange={() => setSaveModal({ ...saveModal, scope: 'shared' })} />
                    {t('queryPage.scopeShared')}
                  </label>
                </div>
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setSaveModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                  <button type="button" onClick={confirmSave} disabled={!saveModal.title.trim() || createMutation.isPending} className="btn-primary">
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
