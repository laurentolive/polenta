import { fieldValueToText, isFieldRequiredNow, objectFieldReader } from '@polenta/types'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useProjectSchema, getReqTypeDef } from '../hooks/useProjectSchema'
import { DynamicField } from '../components/DynamicField'
import { HistorySection } from '../components/history/HistorySection'
import { ExecutionsSection } from '../components/executions/ExecutionsSection'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useRegisterTabDirty, useSetTabTitle } from '../contexts/TabsContext'
import type { Requirement } from '@polenta/types'
import { ParamRefProvider } from '../contexts/ParamRefContext'
import { decodeProjectId } from '../lib/projectId'
import { transitionPreviewKey, useTransitionPreview } from '../hooks/useTransitionPreview'
import { notifyTransitionResult } from '../lib/transitionNotices'
import { draftFields, fieldKeys, useDraftForm, type Draft } from '../lib/draftSync'
import { ExternalChangeBanner } from '../components/ExternalChangeBanner'

export const Route = createFileRoute('/req/$reqId')({
  component: RequirementDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
  }),
})

const STATUS_CLASSES: Record<string, string> = {
  draft:    'bg-status-neutral-bg text-status-neutral',
  review:   'bg-status-warning-bg text-status-warning',
  approved: 'bg-status-success-bg text-status-success',
  obsolete: 'bg-status-danger-bg text-status-danger',
}

/** GH342 — formulaire de l'exigence en clés `title` / `field:<nom>` (brouillon face aux
 *  modifications faites ailleurs). */
function requirementDraft(req: Requirement): Draft {
  const fields: Record<string, string> = {}
  if (req.fields && typeof req.fields === 'object') {
    for (const [k, v] of Object.entries(req.fields as Record<string, unknown>)) fields[k] = fieldValueToText(v)
  }
  return { title: req.title ?? '', ...fieldKeys(fields) }
}

function RequirementDetailPage() {
  const { t } = useTranslation()
  const { reqId } = Route.useParams()
  const qc = useQueryClient()
  const { repoPath, projectId } = Route.useSearch()

  const [confirmObsolete, setConfirmObsolete] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [transitionError, setTransitionError] = useState<string | null>(null)

  const { data: req, isLoading } = useQuery<Requirement>({
    queryKey: ['requirement', repoPath, reqId],
    queryFn: () => api.requirements.get(repoPath, reqId),
    enabled: !!repoPath,
  })

  const { data: schema } = useProjectSchema(repoPath)
  const typeDef = getReqTypeDef(schema, req?.objectTypeRef ?? '')

  // GH342 — brouillon réconcilié avec l'objet relu : un champ changé ailleurs est adopté, sauf s'il
  // est en cours de saisie ici (bandeau) ; l'enregistrement n'envoie que les champs modifiés ici.
  const server = useMemo(() => (req ? requirementDraft(req) : undefined), [req])
  const form = useDraftForm(server, `${repoPath}::${reqId}`)
  const title = form.draft['title'] ?? ''
  const fields = useMemo(() => draftFields(form.draft), [form.draft])
  const setTitle = (v: string) => form.set('title', v)
  const setField = (name: string, v: string) => form.set(`field:${name}`, v)

  // Pas « modifiée » avant que le formulaire ait copié l'objet (gh228 E5) : `changed` est vide tant
  // que le brouillon n'est pas initialisé.
  const hasChanges = form.changed.length > 0
  useRegisterTabDirty(hasChanges)
  useSetTabTitle(req?.title)

  const saveMutation = useMutation({
    // GH342 — base posée dès l'envoi : l'écho de notre écriture n'est pas un conflit.
    onMutate: (values: Draft) => form.markSaved(values),
    mutationFn: (values: Draft) => {
      const changedFields = draftFields(values)
      return api.requirements.update(repoPath, reqId, {
        ...('title' in values ? { title: values['title'] } : {}),
        ...(Object.keys(changedFields).length > 0 ? { fields: changedFields } : {}),
      })
    },
    onSuccess: (_result, values) => {
      qc.invalidateQueries({ queryKey: ['requirements', repoPath] })
      qc.invalidateQueries({ queryKey: ['requirement', repoPath, reqId] })
      setSaveError(null)
    },
    onError: (err: unknown, _values, previous) => {
      if (previous) form.restoreBase(previous)
      setSaveError(err instanceof Error ? err.message : t('common.unknownError'))
    },
  })

  // Ctrl/Cmd+Entrée depuis un champ richtext → « Enregistrer » (no-op sans modification).
  const save = () => saveMutation.mutate(form.changedValues())
  const submitEdit = () => { if (hasChanges && !saveMutation.isPending) save() }

  const workspaceDir = projectId ? decodeProjectId(projectId) : undefined
  // GH206 — pré-contrôle des boutons de statut ; `workspaceDir` : couverture lue sur tout le workspace.
  const { data: transitionChecks } = useTransitionPreview(reqId, true, { repoPath, category: 'requirement', workspaceDir })
  const transitionMutation = useMutation({
    mutationFn: (toStatus: string) => api.requirements.transition(repoPath, reqId, { toStatus }, workspaceDir),
    onSuccess: (result) => {
      notifyTransitionResult(result, reqId)
      qc.invalidateQueries({ queryKey: transitionPreviewKey(repoPath) })
      qc.invalidateQueries({ queryKey: ['requirements', repoPath] })
      qc.invalidateQueries({ queryKey: ['requirement', repoPath, reqId] })
      setConfirmObsolete(false)
      setTransitionError(null)
    },
    onError: (err: unknown) => setTransitionError(err instanceof Error ? err.message : t('common.unknownError')),
  })

  if (!repoPath) {
    return <p className="text-sm text-ink-2 p-4"><Trans i18nKey="requirementsPage.missingRepoPath" components={{ code: <code /> }} /></p>
  }

  if (isLoading) return <p className="text-sm text-ink-3 p-4">{t('common.loading')}</p>
  if (!req) return <p className="text-sm text-ink-2 p-4">{t('requirementsPage.notFound', { reqId })}</p>

  const statusClass = STATUS_CLASSES[req.status] ?? STATUS_CLASSES['draft']

  const statuses = typeDef?.statuses ?? [
    { name: 'draft', label: 'Brouillon' },
    { name: 'review', label: 'En review' },
    { name: 'approved', label: 'Approuvé', isApproval: true },
    { name: 'obsolete', label: 'Obsolète' },
  ]

  const currentStatusIndex = statuses.findIndex(s => s.name === req.status)
  const nextStatus = currentStatusIndex >= 0 && currentStatusIndex < statuses.length - 1
    ? statuses[currentStatusIndex + 1]
    : null
  const obsoleteStatus = statuses.find(s => s.name === 'obsolete')
  const canMarkObsolete = req.status !== 'obsolete' && obsoleteStatus !== undefined && (!nextStatus || nextStatus.name !== 'obsolete')
  // GH200 — exigence approuvée : contenu en lecture seule, les transitions restent (réouverture).
  const locked = !!statuses.find(s => s.name === req.status)?.isApproval

  return (
    <ParamRefProvider repoPath={repoPath} workspaceDir={projectId ? decodeProjectId(projectId) : ''} projectId={projectId}>
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={req.title}
        subtitle={<span className="font-mono">{req.id}</span>}
        actions={
          <>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusClass}`}>
              {req.status}
            </span>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl p-6 space-y-4">
        {locked && (
          <p className="text-xs text-ink-3 bg-surface-2 border border-edge rounded px-2 py-1" data-testid="approved-lock-banner">
            {t('system.editView.approvedLocked')}
          </p>
        )}
        <ExternalChangeBanner
          labels={form.conflicts.map(k => k === 'title'
            ? t('requirementsPage.titleLabel')
            : typeDef?.fields.find(f => `field:${f.name}` === k)?.label ?? k.replace(/^field:/, ''))}
          onReload={() => form.reload(form.conflicts)}
          onKeep={() => form.keep(form.conflicts)}
        />
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            {t('requirementsPage.titleLabel')} <span className="text-status-danger">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            readOnly={locked}
            className="input-field w-full"
          />
        </div>

        {typeDef?.fields.map(f => (
          <DynamicField
            key={f.name}
            field={f}
            value={fields[f.name] ?? String(f.default ?? '')}
            requiredNow={isFieldRequiredNow(f, objectFieldReader(typeDef, { status: req.status, fields: fields }))}
            onChange={v => setField(f.name, v)}
            disabled={locked}
            repoPath={repoPath}
            interfaceRoles={schema?.roles?.map(r => r.name)}
            onSubmit={submitEdit}
          />
        ))}

        {!typeDef && req.fields && Object.keys(req.fields).length > 0 && (
          Object.entries(req.fields as Record<string, unknown>).map(([key, val]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-ink mb-1">{key}</label>
              <input
                type="text"
                value={fields[key] ?? String(val ?? '')}
                onChange={e => setField(key, e.target.value)}
                readOnly={locked}
                className="input-field w-full"
              />
            </div>
          ))
        )}

        {saveError && <p className="text-sm text-status-danger">{saveError}</p>}

        <div className="flex gap-3 items-center flex-wrap">
          <button
            type="button"
            onClick={save}
            disabled={!hasChanges || saveMutation.isPending}
            className="btn-primary"
          >
            {saveMutation.isPending ? t('requirementsPage.saving') : t('requirementsPage.save')}
          </button>
        </div>

        {(nextStatus || canMarkObsolete) && (
          <div className="border-t border-edge pt-4 mt-2">
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-3">
              {t('requirementsPage.statusTransitions')}
            </p>

            {transitionError && <p className="text-sm text-status-danger mb-2">{transitionError}</p>}

            <div className="flex gap-3 items-center flex-wrap">
              {nextStatus && (
                <button
                  type="button"
                  onClick={() => transitionMutation.mutate(nextStatus.name)}
                  disabled={transitionMutation.isPending || !!transitionChecks?.[nextStatus.name]?.blocked}
                  title={transitionChecks?.[nextStatus.name]?.issues.map(i => i.message).join('\n') || undefined}
                  data-testid="req-next-status"
                  className={`rounded px-4 py-2 text-sm disabled:opacity-50 transition-colors hover:opacity-90 ${
                    nextStatus.isApproval
                      ? 'bg-status-success-solid text-status-success-fg'
                      : 'bg-status-warning-solid text-status-warning-fg'
                  }`}
                >
                  {transitionMutation.isPending
                    ? t('requirementsPage.transitioning')
                    : `${transitionChecks?.[nextStatus.name]?.issues.length && !transitionChecks[nextStatus.name].blocked ? '⚠ ' : ''}${nextStatus.isApproval
                      ? t('requirementsPage.approve', { label: nextStatus.label ?? nextStatus.name })
                      : nextStatus.label ?? nextStatus.name}`}
                </button>
              )}
              {nextStatus && transitionChecks?.[nextStatus.name]?.blocked && (
                <p className="text-xs text-status-danger w-full" data-testid="req-next-status-blocked">
                  {transitionChecks[nextStatus.name].issues.filter(i => i.level === 'block').map(i => i.message).join(' ; ')}
                </p>
              )}

              {canMarkObsolete && !confirmObsolete && (
                <button
                  type="button"
                  onClick={() => setConfirmObsolete(true)}
                  className="btn-danger"
                >
                  {t('requirementsPage.markObsolete')}
                </button>
              )}

              {confirmObsolete && (
                <div className="flex items-center gap-2 border border-status-danger-border rounded px-3 py-2 bg-status-danger-bg">
                  <span className="text-sm text-status-danger">{t('requirementsPage.confirmObsolete')}</span>
                  <button
                    type="button"
                    onClick={() => transitionMutation.mutate('obsolete')}
                    disabled={transitionMutation.isPending}
                    className="btn-danger"
                  >
                    {transitionMutation.isPending ? t('requirementsPage.transitioning') : t('requirementsPage.yesObsolete')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmObsolete(false)}
                    className="btn-secondary"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* GH197 — historique des exécutions des tests qui couvrent l'exigence. */}
        <ExecutionsSection repoPath={repoPath} projectId={projectId} workspaceDir={projectId ? decodeProjectId(projectId) : undefined} target={{ requirementId: reqId }} typeKey={req.objectTypeRef} />

        {/* GH77 — historique des champs suivis (lecture seule). */}
        <HistorySection repoPath={repoPath} kind="requirement" id={reqId} typeDef={typeDef}
          refreshKey={`${req.status}:${JSON.stringify(req.history ?? null)}`} />
      </div>
      </div>
    </div>
    </ParamRefProvider>
  )
}
