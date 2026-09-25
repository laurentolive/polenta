import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useProjectSchema, getReqTypeDef } from '../hooks/useProjectSchema'
import { DynamicField } from '../components/DynamicField'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useRegisterTabDirty, useSetTabTitle } from '../contexts/TabsContext'
import type { Requirement } from '@polenta/types'
import { ParamRefProvider } from '../contexts/ParamRefContext'
import { decodeProjectId } from '../lib/projectId'

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

function getStringField(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === 'string' ? v : (v !== undefined && v !== null ? String(v) : '')
}

function RequirementDetailPage() {
  const { t } = useTranslation()
  const { reqId } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { repoPath, projectId } = Route.useSearch()

  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [initialized, setInitialized] = useState(false)
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

  useEffect(() => {
    if (req && !initialized) {
      setTitle(req.title ?? '')
      const stringFields: Record<string, string> = {}
      if (req.fields && typeof req.fields === 'object') {
        for (const [k, v] of Object.entries(req.fields as Record<string, unknown>)) {
          stringFields[k] = v !== undefined && v !== null ? String(v) : ''
        }
      }
      setFields(stringFields)
      setInitialized(true)
    }
  }, [req, initialized])

  const hasChanges = req
    ? title !== (req.title ?? '') ||
      Object.keys(fields).some(k => fields[k] !== getStringField(req.fields as Record<string, unknown>, k)) ||
      (typeDef?.fields ?? []).some(f => {
        const reqVal = getStringField(req.fields as Record<string, unknown>, f.name)
        return (fields[f.name] ?? '') !== reqVal
      })
    : false
  useRegisterTabDirty(hasChanges)
  useSetTabTitle(req?.title)

  const saveMutation = useMutation({
    mutationFn: () => api.requirements.update(repoPath, reqId, { title, fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requirements', repoPath] })
      qc.invalidateQueries({ queryKey: ['requirement', repoPath, reqId] })
      setInitialized(false)
      setSaveError(null)
    },
    onError: (err: unknown) => setSaveError(err instanceof Error ? err.message : t('common.unknownError')),
  })

  // Ctrl/Cmd+Entrée depuis un champ richtext → « Enregistrer » (no-op sans modification).
  const submitEdit = () => { if (hasChanges && !saveMutation.isPending) saveMutation.mutate() }

  const transitionMutation = useMutation({
    mutationFn: (toStatus: string) => api.requirements.transition(repoPath, reqId, { toStatus }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requirements', repoPath] })
      qc.invalidateQueries({ queryKey: ['requirement', repoPath, reqId] })
      setConfirmObsolete(false)
      setTransitionError(null)
      setInitialized(false)
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

  return (
    <ParamRefProvider repoPath={repoPath} workspaceDir={projectId ? decodeProjectId(projectId) : ''} projectId={projectId}>
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={req.title}
        subtitle={<span className="font-mono">{req.id}</span>}
        actions={
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusClass}`}>
            {req.status}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            {t('requirementsPage.titleLabel')} <span className="text-status-danger">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="input-field w-full"
          />
        </div>

        {typeDef?.fields.map(f => (
          <DynamicField
            key={f.name}
            field={f}
            value={fields[f.name] ?? String(f.default ?? '')}
            onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))}
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
                onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
                className="input-field w-full"
              />
            </div>
          ))
        )}

        {saveError && <p className="text-sm text-status-danger">{saveError}</p>}

        <div className="flex gap-3 items-center flex-wrap">
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
            className="btn-primary"
          >
            {saveMutation.isPending ? t('requirementsPage.saving') : t('requirementsPage.save')}
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/schema', search: { repoPath, projectId } })}
            className="btn-secondary"
          >
            {t('layout.viewHeader.back')}
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
                  disabled={transitionMutation.isPending}
                  className={`rounded px-4 py-2 text-sm disabled:opacity-50 transition-colors hover:opacity-90 ${
                    nextStatus.isApproval
                      ? 'bg-status-success-solid text-status-success-fg'
                      : 'bg-status-warning-solid text-status-warning-fg'
                  }`}
                >
                  {transitionMutation.isPending
                    ? t('requirementsPage.transitioning')
                    : nextStatus.isApproval
                      ? t('requirementsPage.approve', { label: nextStatus.label ?? nextStatus.name })
                      : nextStatus.label ?? nextStatus.name}
                </button>
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
      </div>
      </div>
    </div>
    </ParamRefProvider>
  )
}
