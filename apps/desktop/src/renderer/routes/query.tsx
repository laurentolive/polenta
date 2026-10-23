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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Play, Save, Search as SearchIcon } from 'lucide-react'
import type { GraphParamValue, QueryColumnDef, QueryParameterDef, QueryResult, QueryScope, ScriptRunResult } from '@polenta/types'
import { dashboardSelectors, paramsForQuery, validateColumnDecl, validateParameterDecls } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ResultTable } from '../components/dashboard/ResultTable'
import { CodeEditor } from '../components/dashboard/CodeEditor'
import { TemplateForm } from '../components/dashboard/TemplateForm'
import { ParamBar } from '../components/dashboard/ParamBar'
import { ParameterDeclEditor } from '../components/dashboard/ParameterDeclEditor'
import { ColumnDeclEditor } from '../components/dashboard/ColumnDeclEditor'
import { effectiveValues } from '../lib/suiviParamValues'
import type { ParamOptions } from '../lib/suiviParamValues'
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
  const { data: objectTypes = [], isSuccess: objectTypesLoaded } = useSuiviObjectTypes(repoPath, workspaceDir)
  const { data: campaigns = [], isSuccess: campaignsLoaded } = useCampaignOptions(repoPath)

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
  /** GH93 — déclaration des paramètres (mode Script) et valeurs de la barre (non mémorisées). */
  const [declaration, setDeclaration] = useState<QueryParameterDef[]>([])
  const [paramValues, setParamValues] = useState<Record<string, GraphParamValue>>({})
  /** GH70 — déclaration de colonne calculée de la Vue Système (mode Script). */
  const [columnDecl, setColumnDecl] = useState<QueryColumnDef | null>(null)
  const loadedRef = useRef<string | undefined>(undefined)
  // Une réponse dont l'id n'est plus le dernier émis (autre requête ouverte entre-temps) est ignorée.
  const requestIdRef = useRef(0)

  const template = catalog?.queries.find((q) => q.id === templateId)
  const readOnly = current?.state.readOnly

  // GH93 — déclaration générée par le modèle (affichée en lecture seule).
  const { data: rendered } = useQuery({
    queryKey: ['suivi-render-template', 'query', templateId, JSON.stringify(params)],
    queryFn: () => api.suivi.renderTemplate('query', { id: templateId, params }),
    enabled: mode === 'template' && !!template,
  })
  const decls = mode === 'template' ? (rendered?.parameters ?? []) : declaration
  const declErrors = mode === 'script' ? validateParameterDecls(declaration).errors : []
  // GH70 — colonne : générée par le modèle (lecture seule) ou saisie ; réservée aux requêtes partagées.
  // GH70 — colonne indépendante du modèle (sprint 3) : saisie dans les deux modes ; un modèle peut en
  // proposer une, préremplie à sa sélection sur une requête non enregistrée.
  const column = columnDecl
  const columnErrors = validateColumnDecl(columnDecl).errors
  const columnPrefilledFor = useRef<string | null>(null)
  /** Colonne préremplie depuis le modèle, telle quelle : non modifiée, elle n'est pas « fournie ». */
  const prefilledColumn = useRef<QueryColumnDef | null>(null)
  useEffect(() => {
    if (mode !== 'template' || current || !rendered || columnPrefilledFor.current === templateId) return
    columnPrefilledFor.current = templateId
    // Une déclaration saisie (ou modifiée après préremplissage) n'est jamais écrasée.
    if (columnDecl !== null && columnDecl !== prefilledColumn.current) return
    prefilledColumn.current = rendered.column ?? null
    setColumnDecl(rendered.column ?? null)
  }, [mode, current, rendered, templateId, columnDecl])
  const columnProvided = !!columnDecl && columnDecl !== prefilledColumn.current
  // Requête privée : une colonne (générée par un modèle, ou restée cochée) n'est pas enregistrable.
  const saveBlocked = declErrors.length > 0 || columnErrors.length > 0 || (current?.scope === 'private' && !!column)
  // Liste en chargement : absente (n'invalide aucune valeur), pas vide.
  const paramOptions = useMemo<ParamOptions>(() => ({
    campaigns: campaignsLoaded ? campaigns : undefined,
    components: objectTypesLoaded ? [...new Set(objectTypes.map((o) => o.component))].sort() : undefined,
    objectTypes: objectTypesLoaded ? objectTypes : undefined,
  }), [campaigns, objectTypes, campaignsLoaded, objectTypesLoaded])
  const selectorsOf = (d: QueryParameterDef[]) => dashboardSelectors([{ id: 'query', queryId: 'query' }], () => d)
  // Barre : dernière déclaration valide (une ligne en cours de saisie n'y apparaît pas).
  const lastValidDecls = useRef<QueryParameterDef[]>([])
  if (declErrors.length === 0) lastValidDecls.current = decls
  const barDecls = declErrors.length === 0 ? decls : lastValidDecls.current
  const selectors = useMemo(() => selectorsOf(barDecls), [barDecls])
  const effective = useMemo(() => effectiveValues(selectors, paramValues, paramOptions), [selectors, paramValues, paramOptions])

  /** Script et déclaration courants : générés par le modèle (un seul rendu), ou ceux de l'éditeur. */
  async function currentCode(): Promise<{ script: string; parameters: QueryParameterDef[] }> {
    if (mode === 'script') return { script, parameters: declaration }
    return api.suivi.renderTemplate('query', { id: templateId, params })
  }

  async function execute(code?: string, withDecls?: QueryParameterDef[], values: Record<string, GraphParamValue> = paramValues) {
    if (!repoPath || !username) return
    const reqId = ++requestIdRef.current
    setIsExecuting(true)
    try {
      const generated = code === undefined || withDecls === undefined ? await currentCode() : null
      const text = code ?? generated!.script
      const parameters = withDecls ?? generated!.parameters
      const chosen = effectiveValues(selectorsOf(parameters), values, paramOptions).values
      const res = await api.suivi.run(repoPath, workspaceDir, username, { script: text, parameters, params: paramsForQuery(parameters, chosen) }, clientInfo())
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
    setDeclaration([])
    setColumnDecl(null)
    columnPrefilledFor.current = null
    prefilledColumn.current = null
    setParamValues({})
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
    // Valeurs initiales = défauts de la déclaration (pas de mémorisation dans cette vue).
    const loadedDecls = saved?.parameters ?? []
    setScript(text)
    setScriptBaseline(text)
    setDeclaration(loadedDecls)
    setColumnDecl(saved?.column ?? null)
    columnPrefilledFor.current = saved?.template?.id ?? null
    setParamValues({})
    setConfirmTemplate(false)
    void execute(text, loadedDecls, {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryId, savedQueries, history])

  const invalidateQueries = () => qc.invalidateQueries({ queryKey: ['queries', repoPath, username] })

  const createMutation = useMutation({
    mutationFn: async (dto: { title: string; scope: QueryScope }) =>
      api.queries.create(repoPath, username, {
        ...dto, createdBy: username,
        // Colonne préremplie non modifiée : omise, le modèle la propose lui-même (sans objet en privé).
        ...(mode === 'template' ? { template: { id: templateId, params }, ...(columnProvided || !columnDecl ? { column: columnDecl } : {}) } : { script, parameters: declaration, column: columnDecl }),
      }),
    onSuccess: (q) => {
      setSaveModal(null)
      invalidateQueries()
      loadedRef.current = q.id
      navigate({ to: '/query', search: { projectId, queryId: q.id } })
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      // GH70 — la colonne est envoyée si elle existe, existait, ou si la déclaration lue est invalide
      // (`null` la retire) ; sinon le champ est omis (requête privée sans colonne : rien à toucher).
      const columnDto = columnDecl || current?.column || current?.columnError ? { column: columnDecl } : {}
      return api.queries.update(repoPath, username, current!.id, mode === 'template'
        ? { template: { id: templateId, params }, ...columnDto }
        : { script, parameters: declaration, ...columnDto })
    },
    onSuccess: () => {
      invalidateQueries()
      // Les widgets qui utilisent cette requête sont réexécutés (leur clé porte le script) ; une
      // requête de seed modifiée n'est plus proposée au bandeau des mises à jour.
      qc.invalidateQueries({ queryKey: ['widget-query-result'] })
      qc.invalidateQueries({ queryKey: ['suivi-updates'] })
    },
  })

  // GH70 — « Enregistrer sous » en privé une requête qui déclare une colonne : refusé.
  const saveModalColumnBlocked = !!saveModal && saveModal.scope === 'private' && (mode === 'script' ? !!column : columnProvided)
  function confirmSave() {
    if (!saveModal || !saveModal.title.trim() || saveModalColumnBlocked) return
    createMutation.mutate({ title: saveModal.title.trim(), scope: saveModal.scope })
  }
  useModalHotkeys(() => setSaveModal(null), confirmSave, !saveModal || createMutation.isPending)

  const deleteHistoryMutation = useMutation({
    mutationFn: (id: string) => api.queries.historyDelete(repoPath, username, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries-history', repoPath, username] }),
  })

  const result: QueryResult | null = run ? toQueryResult(run) : null
  const currentQueryName = current?.title || 'resultat'
  // Entrée d'historique : modèle et paramètres d'un script généré (« Modèle « filtered-list » v1
  // {"category":…} »), sinon sa première ligne de code.
  const firstLine = (s: string) => {
    const header = /^\/\/ (Modèle « [^»]+ » v\d+)/m.exec(s)?.[1]
    const params = /^const P = (\{[\s\S]*?\n\})/m.exec(s)?.[1]
    if (header) {
      try {
        return params ? `${header} ${JSON.stringify(JSON.parse(params))}` : header
      } catch {
        return header // paramètres modifiés à la main, illisibles en JSON
      }
    }
    return s.split('\n').find((l) => l.trim() && !l.trim().startsWith('//'))?.trim() ?? s.slice(0, 60)
  }
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
                        const generated = await api.suivi.renderTemplate('query', { id: templateId, params })
                        setScript(generated.script)
                        setScriptBaseline(generated.script)
                        setDeclaration(generated.parameters)
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
                  <button type="button" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending || saveBlocked} className="btn-secondary-sm flex items-center gap-1.5">
                    <Save size={12} /> {t('requirementsPage.save')}
                  </button>
                )}
                <button type="button" onClick={() => setSaveModal({ title: current ? `${current.title} (2)` : '', scope: column ? 'shared' : 'private' })} disabled={saveBlocked} className="btn-secondary-sm flex items-center gap-1.5">
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

              {/* GH93 — paramètres choisis à l'affichage : déclaration (générée par le modèle, ou éditée). */}
              {(mode === 'script' || decls.length > 0) && (
                <ParameterDeclEditor value={decls} onChange={setDeclaration} readOnly={mode === 'template' || !!readOnly} />
              )}
              {/* GH70 — colonne calculée de la Vue Système (requête partagée). */}
              {current?.columnError && (
                <p className="flex items-start gap-2 text-xs text-status-danger" data-testid="column-error">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {t('queryPage.column.readError', { message: current.columnError })}
                </p>
              )}
              <ColumnDeclEditor
                value={column}
                onChange={setColumnDecl}
                defaultLabel={current?.title ?? ''}
                objectTypes={objectTypes}
                resultColumns={result?.columns.map((c) => c.name) ?? []}
                readOnly={!!readOnly}
                unavailableReason={current?.scope === 'private' ? t('queryPage.column.sharedOnly') : undefined}
              />
              <ParamBar
                selectors={selectors}
                values={effective.values}
                invalid={effective.invalid}
                options={paramOptions}
                // Déclaration en cours de saisie invalide : exécution avec la dernière valide (celle de la barre).
                onChange={(key, v) => {
                  const next = { ...paramValues, [key]: v }
                  setParamValues(next)
                  if (run) void execute(undefined, barDecls, next)
                }}
                onReset={() => {
                  setParamValues({})
                  if (run) void execute(undefined, barDecls, {})
                }}
              />

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
                {saveModalColumnBlocked && (
                  <p className="text-xs text-status-danger mb-4" data-testid="save-column-private">{t('queryPage.column.privateRefused')}</p>
                )}
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setSaveModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                  <button type="button" onClick={confirmSave} disabled={!saveModal.title.trim() || createMutation.isPending || saveModalColumnBlocked} className="btn-primary">
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
