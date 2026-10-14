/**
 * WidgetConfigModal — ajout / modification d'un widget de la vue Suivi (T77 ; GH74 : specs/GH74.md §7).
 *
 * Titre, requête (filtrée sur les requêtes partagées quand le dashboard est partagé — jamais de
 * validation après coup), taille, puis le contenu :
 * - onglet **Modèle** : choix d'un modèle et de ses paramètres (colonnes proposées = colonnes du
 *   résultat de la requête) ; le code est généré par le main ;
 * - onglet **Code** : transformation JS (`(rows, polenta) => rows`) et spec Vega-Lite. Modifier le
 *   code détache le widget de son modèle ; « Revenir au modèle » régénère le code.
 * Aperçu en direct : requête + transformation exécutées dans le bac à sable, rendu identique à la grille.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Code2, LayoutTemplate, RotateCcw, X } from 'lucide-react'
import type { QueryScope, SavedQuery, Widget, WidgetCode, WidgetSize } from '@polenta/types'
import type { TemplateInput } from '@polenta/api-client'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { useScriptRun } from '../../hooks/useScriptRun'
import { useCampaignOptions, useSuiviTemplates } from '../../hooks/useSuiviCatalog'
import { WidgetRenderer } from './widgets/WidgetRenderer'
import { TemplateForm } from './TemplateForm'
import { CodeEditor } from './CodeEditor'
import { hasVegaAggregate } from './vegaTheme'

/** Contenu enregistré : modèle + paramètres, ou code (transformation + spec). */
export type WidgetConfigResult =
  | { title: string; queryId: string; size: WidgetSize; template: TemplateInput }
  | { title: string; queryId: string; size: WidgetSize; transform: string | null; spec: string }

interface Props {
  dashboardScope: QueryScope
  savedQueries: SavedQuery[]
  repoPath: string
  workspaceDir: string
  username: string
  onSave: (dto: WidgetConfigResult) => void
  onClose: () => void
  saving?: boolean
  /** Refus du serveur (ex. dashboard partagé entre-temps, qui refuse une requête privée). */
  error?: string | null
  /** Widget modifié : formulaire prérempli, libellé « Modifier ». */
  initialWidget?: Widget | null
}

const SIZE_OPTIONS: { value: WidgetSize; labelKey: string }[] = [
  { value: 'sm', labelKey: 'dashboard.widgetModal.sizeSmall' },
  { value: 'md', labelKey: 'dashboard.widgetModal.sizeMedium' },
  { value: 'lg', labelKey: 'dashboard.widgetModal.sizeLarge' },
]

export function WidgetConfigModal({ dashboardScope, savedQueries, repoPath, workspaceDir, username, onSave, onClose, saving, error, initialWidget }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'fr'
  const availableQueries = dashboardScope === 'shared' ? savedQueries.filter((q) => q.scope === 'shared') : savedQueries
  const { data: catalog } = useSuiviTemplates()
  const { data: campaigns = [] } = useCampaignOptions(repoPath)

  const customized = !!initialWidget && initialWidget.state.customized
  const [title, setTitle] = useState(initialWidget?.title ?? '')
  const [queryId, setQueryId] = useState(initialWidget?.queryId ?? '')
  const [size, setSize] = useState<WidgetSize>(initialWidget?.size ?? 'md')
  const [tab, setTab] = useState<'template' | 'code'>(initialWidget && (customized || !initialWidget.template) ? 'code' : 'template')
  const [templateId, setTemplateId] = useState(initialWidget?.template?.id ?? 'bar')
  const [params, setParams] = useState<Record<string, unknown>>(initialWidget?.template?.params ?? {})
  const [transform, setTransform] = useState(initialWidget?.transform ?? '')
  const [spec, setSpec] = useState(initialWidget?.spec ?? '{\n  "data": { "name": "rows" },\n  "mark": "bar"\n}\n')
  /** Le code a été modifié dans l'onglet Code : enregistré tel quel (widget détaché). */
  const [codeEdited, setCodeEdited] = useState(customized)
  /** « Revenir au modèle » demandé : confirmation (le code modifié est perdu). */
  const [confirmRevert, setConfirmRevert] = useState(false)

  const template = catalog?.widgets.find((w) => w.id === templateId)

  // Code généré par le modèle (aperçu et passage à l'onglet Code), recalculé à chaque paramètre.
  const { data: generated } = useQuery<WidgetCode>({
    queryKey: ['suivi-render-template', templateId, JSON.stringify(params)],
    queryFn: () => api.suivi.renderTemplate('widget', { id: templateId, params }),
    enabled: tab === 'template' && !!template,
  })

  // Passage Modèle → Code : on part du code généré.
  useEffect(() => {
    if (tab === 'template' && generated && !codeEdited) {
      setTransform(generated.transform ?? '')
      setSpec(generated.spec)
    }
  }, [generated, tab, codeEdited])

  // Lignes de la requête seule : colonnes proposées par le formulaire.
  const { data: queryRun } = useScriptRun(repoPath, workspaceDir, username, queryId ? { queryId, transform: null } : null)
  const columns = useMemo(() => (queryRun?.ok ? queryRun.columns.map((c) => c.name) : []), [queryRun])

  // Aperçu : requête + transformation courante.
  const effective = tab === 'template' && generated && !codeEdited ? generated : { transform: transform || undefined, spec }
  const { data: previewRun, isLoading } = useScriptRun(
    repoPath, workspaceDir, username,
    queryId ? { queryId, transform: effective.transform ?? null, transformFile: 'transform.js' } : null,
  )

  const missingRequired = tab === 'template' && !!template?.params.some((p) => p.required && (params[p.name] === undefined || params[p.name] === ''))
  const canSave = !!title.trim() && !!queryId && !saving && (tab === 'code' ? !!spec.trim() : !!template && !missingRequired)

  function save() {
    if (!canSave) return
    const base = { title: title.trim(), queryId, size }
    // Code non modifié (même affiché dans l'onglet Code) : le modèle est enregistré, pas le code.
    if (!codeEdited && template) onSave({ ...base, template: { id: templateId, params } })
    else onSave({ ...base, transform: transform.trim() ? transform : null, spec })
  }

  function revertToTemplate() {
    if (!initialWidget?.template) return
    setTemplateId(initialWidget.template.id)
    setParams(initialWidget.template.params)
    setCodeEdited(false)
    setConfirmRevert(false)
    setTab('template')
  }

  useModalHotkeys(onClose, save, !canSave)

  return (
    <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-20 p-4">
      <div role="dialog" aria-label={t(initialWidget ? 'dashboard.widgetModal.editTitle' : 'dashboard.widgetModal.addTitle')} className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink">{t(initialWidget ? 'dashboard.widgetModal.editTitle' : 'dashboard.widgetModal.addTitle')}</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink" title={t('common.close')}><X size={16} /></button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-2 gap-5 p-5 overflow-hidden">
          <div className="space-y-3 overflow-y-auto pr-1">
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-3 w-24 shrink-0">{t('dashboard.widgetModal.titleLabel')}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className="input-field flex-1 text-xs py-1" placeholder={t('dashboard.widgetModal.titlePlaceholder')} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-3 w-24 shrink-0">{t('dashboard.widgetModal.queryLabel')}</label>
              <select value={queryId} onChange={(e) => setQueryId(e.target.value)} className="input-field flex-1 text-xs py-1" aria-label={t('dashboard.widgetModal.queryLabel')}>
                <option value="">{t('dashboard.widgetModal.selectPlaceholder')}</option>
                {availableQueries.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
              </select>
            </div>
            {dashboardScope === 'shared' && availableQueries.length < savedQueries.length && (
              <p className="text-[11px] text-ink-3">{t('dashboard.widgetModal.sharedOnlyHint')}</p>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-3 w-24 shrink-0">{t('dashboard.widgetModal.sizeLabel')}</label>
              <div className="flex gap-3">
                {SIZE_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-1 text-xs text-ink-2">
                    <input type="radio" checked={size === o.value} onChange={() => setSize(o.value)} />
                    {t(o.labelKey)}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-edge-subtle">
              <div className="flex rounded-lg border border-edge overflow-hidden text-xs">
                <button type="button" onClick={() => setTab('template')} className={`px-3 py-1.5 flex items-center gap-1.5 ${tab === 'template' ? 'bg-status-info-solid text-status-info-fg' : 'text-ink-2 hover:bg-hover'}`}>
                  <LayoutTemplate size={12} /> {t('dashboard.widgetModal.templateTab')}
                </button>
                <button type="button" onClick={() => setTab('code')} className={`px-3 py-1.5 flex items-center gap-1.5 ${tab === 'code' ? 'bg-status-info-solid text-status-info-fg' : 'text-ink-2 hover:bg-hover'}`}>
                  <Code2 size={12} /> {t('dashboard.widgetModal.codeTab')}
                </button>
              </div>
              {codeEdited && initialWidget?.template && (confirmRevert ? (
                <span className="ml-auto flex items-center gap-2 text-xs text-ink-2" data-testid="revert-confirm">
                  {t('dashboard.widgetModal.revertConfirm')}
                  <button type="button" onClick={revertToTemplate} className="btn-secondary-sm">{t('dashboard.widgetModal.revert')}</button>
                  <button type="button" onClick={() => setConfirmRevert(false)} className="text-ink-3 hover:text-ink underline">{t('common.cancel')}</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmRevert(true)} className="btn-secondary-sm flex items-center gap-1.5 ml-auto" title={t('dashboard.widgetModal.revertHint')}>
                  <RotateCcw size={12} /> {t('dashboard.widgetModal.revert')}
                </button>
              ))}
            </div>

            {tab === 'template' ? (
              codeEdited ? (
                <p className="text-xs text-ink-2 bg-canvas border border-edge rounded px-3 py-2" data-testid="widget-customized">
                  {t('dashboard.widgetModal.customizedNotice')}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-ink-3 w-24 shrink-0">{t('dashboard.widgetModal.templateLabel')}</label>
                    <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setParams({}) }} className="input-field flex-1 text-xs py-1" aria-label={t('dashboard.widgetModal.templateLabel')}>
                      {(catalog?.widgets ?? []).map((w) => <option key={w.id} value={w.id}>{w.label[lang]}</option>)}
                    </select>
                  </div>
                  {template && <TemplateForm params={template.params} value={params} onChange={setParams} columns={columns} campaigns={campaigns} />}
                  {initialWidget?.state.templateUpdate && (
                    <p className="text-[11px] text-status-info">{t('dashboard.widgetModal.templateUpdate', { version: initialWidget.state.templateUpdate })}</p>
                  )}
                </div>
              )
            ) : (
              <div className="space-y-2">
                {customized || codeEdited ? null : (
                  <p className="text-[11px] text-ink-3">{t('dashboard.widgetModal.codeDetachHint')}</p>
                )}
                <p className="text-xs text-ink-3">{t('dashboard.widgetModal.transformLabel')}</p>
                <CodeEditor language="javascript" value={transform} onChange={(v) => { setTransform(v); setCodeEdited(true) }} minHeight={120} ariaLabel={t('dashboard.widgetModal.transformLabel')}
                  errorLine={previewRun && !previewRun.ok && previewRun.error.file === 'transform.js' ? previewRun.error.line : null} />
                <p className="text-xs text-ink-3">{t('dashboard.widgetModal.specLabel')}</p>
                <CodeEditor language="json" value={spec} onChange={(v) => { setSpec(v); setCodeEdited(true) }} minHeight={160} ariaLabel={t('dashboard.widgetModal.specLabel')} />
                {(() => {
                  try { return hasVegaAggregate(JSON.parse(spec)) } catch { return false }
                })() && <p className="text-[11px] text-status-warning">{t('dashboard.widgetModal.aggregateWarning')}</p>}
              </div>
            )}
          </div>

          <div className="flex flex-col min-h-0 border border-edge rounded-lg overflow-hidden">
            <p className="px-3 py-2 text-xs font-medium text-ink-2 border-b border-edge-subtle shrink-0">{t('dashboard.widgetModal.previewTitle')}</p>
            <div className="flex-1 min-h-[260px] p-2">
              {!queryId ? (
                <p className="text-xs text-ink-3 italic text-center pt-10">{t('dashboard.widgetModal.selectQueryHint')}</p>
              ) : isLoading ? (
                <p className="text-xs text-ink-3 text-center pt-10">{t('common.loading')}</p>
              ) : (
                <WidgetRenderer spec={tab === 'template' && generated && !codeEdited ? generated.spec : spec} run={previewRun} />
              )}
            </div>
          </div>
        </div>

        {error && <p className="mx-5 mb-2 text-xs text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">{error}</p>}
        <div className="flex gap-3 justify-end px-5 py-3 border-t border-edge shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={save} disabled={!canSave} className="btn-primary">
            {saving ? t('requirementsPage.saving') : t('requirementsPage.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
