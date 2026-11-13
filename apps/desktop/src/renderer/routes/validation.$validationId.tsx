import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import type { ValidationProblem } from '@polenta/types'
import { fieldValueToText } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { DynamicField } from '../components/DynamicField'
import { useSetTabTitle } from '../contexts/TabsContext'
import { useModalHotkeys } from '../hooks/useModalHotkeys'
import { ValidationGrid } from '../components/validation/ValidationGrid'
import { useInvalidateValidations, useValidationPage, validationErrorText, VALIDATION_STATE_BADGE } from '../components/validation/useValidations'
import { STATE_BADGE, useInvalidateVersions } from '../components/versions/useVersions'
import { backdropDismiss } from '../lib/backdropDismiss'

/** GH204 §7 — page d'une validation. URL : /validation/<ID>?projectId=…&repoPath=… */
export const Route = createFileRoute('/validation/$validationId')({
  component: ValidationView,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: (s['repoPath'] as string) ?? '',
  }),
})

type Confirming = 'sign' | 'cancel' | 'delete' | null

function ValidationView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { validationId } = Route.useParams()
  const { projectId, repoPath } = Route.useSearch()
  const workspaceDir = projectId ? decodeProjectId(projectId) || undefined : undefined
  const { data: page, error: loadError, isLoading } = useValidationPage(repoPath, validationId, projectId)
  const invalidate = useInvalidateValidations()
  const invalidateVersions = useInvalidateVersions()
  useSetTabTitle(page ? `${page.validation.title} (${page.validation.id})` : validationId)

  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Confirming>(null)
  // Sur les valeurs enregistrées, pas sur la page : une relecture (autre décision, watcher) garde la saisie.
  const savedTitle = page?.validation.title
  const savedFields = JSON.stringify(page?.validation.fields ?? null)
  useEffect(() => {
    if (savedTitle !== undefined) setTitle(savedTitle)
  }, [savedTitle])
  useEffect(() => {
    const saved = JSON.parse(savedFields) as Record<string, unknown> | null
    if (saved) setFields(saved)
  }, [savedFields])

  const run = async (op: () => Promise<unknown>) => {
    setError(null)
    try {
      await op()
      await invalidate()
      await invalidateVersions()
      return true
    } catch (err) {
      setError(validationErrorText(t, err))
      return false
    }
  }

  if (isLoading) return <p className="p-4 text-xs text-ink-3 italic">{t('common.loading')}</p>
  if (!page) return <p className="p-4 text-xs text-status-danger">{loadError ? validationErrorText(t, loadError) : validationId}</p>

  const { validation, typeDef, state, version } = page
  const open = state === 'open'
  const editable = open && !page.readonly && version.state !== 'abandoned'
  const fieldsDirty = JSON.stringify(fields) !== JSON.stringify(validation.fields)
  const statusLabel = typeDef.statuses?.find(s => s.name === validation.status)?.label || validation.status

  const confirmAction = async () => {
    const action = confirming
    setConfirming(null)
    if (action === 'sign') await run(() => api.validations.sign(repoPath, validation.id, workspaceDir))
    if (action === 'cancel') await run(() => api.validations.cancel(repoPath, validation.id, workspaceDir))
    if (action === 'delete' && await run(() => api.validations.delete(repoPath, validation.id, workspaceDir))) {
      void navigate({ to: '/validations', search: { projectId } })
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="validation-page">
      <ViewHeader
        currentProjectId={projectId}
        title={validation.title}
        subtitle={validation.id}
        actions={
          <>
            {page.readonly && <span title={t('validation.readonly')}><Lock size={13} className="text-status-warning" /></span>}
            {editable && <button type="button" className="btn-primary-sm" onClick={() => setConfirming('sign')} data-testid="validation-sign">{t('validation.sign')}</button>}
            {!page.readonly && state !== 'cancelled' && <button type="button" className="btn-secondary-sm" onClick={() => setConfirming('cancel')} data-testid="validation-cancel">{t('validation.cancel')}</button>}
            {!page.readonly && open && <button type="button" className="btn-secondary-sm" onClick={() => setConfirming('delete')} data-testid="validation-delete">{t('common.delete')}</button>}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {error && <p className="text-xs text-status-danger whitespace-pre-wrap" role="alert">{error}</p>}
        {page.readonly && <p className="text-xs text-status-warning" data-testid="validation-readonly">{t('validation.readonlyHelp')}</p>}
        {version.state === 'abandoned' && <p className="text-xs text-status-warning" data-testid="validation-version-abandoned">{t('validation.versionAbandoned')}</p>}

        <section className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-xs items-center max-w-3xl">
          <span className="text-ink-3">{t('validation.titleLabel')}</span>
          {editable ? (
            <input value={title} onChange={e => setTitle(e.target.value)} className="input-field text-sm max-w-md" data-testid="validation-title"
              onBlur={() => { if (title.trim() && title !== validation.title) void run(() => api.validations.update(repoPath, validation.id, { title }, workspaceDir)) }} />
          ) : <span className="text-sm text-ink">{validation.title}</span>}

          <span className="text-ink-3">{t('validation.status')}</span>
          <span className="flex items-center gap-2">
            <span className={`px-1.5 rounded text-[10px] ${VALIDATION_STATE_BADGE[state]}`} data-testid="validation-state">{statusLabel}</span>
            {page.signed && <span className="text-ink-3" data-testid="validation-signed">{t('validation.signedBy', { by: page.signed.by ?? '?', at: page.signed.at.slice(0, 16).replace('T', ' ') })}</span>}
          </span>

          <span className="text-ink-3">{t('validation.version')}</span>
          <span className="flex items-center gap-2">
            <button type="button" className="text-prim hover:underline" onClick={() => void navigate({ to: '/version/$versionId', params: { versionId: version.id }, search: { projectId, repoPath } })}>{version.title} ({version.id})</button>
            <span className={`px-1.5 rounded text-[10px] ${STATE_BADGE[version.state]}`} data-testid="validation-version-state">{t(`versions.state.${version.state}`)}</span>
          </span>

          {open && (
            <>
              <span className="text-ink-3">{t('validation.remaining')}</span>
              <span className="text-ink font-medium" data-testid="validation-remaining">{page.pendingCount}</span>
            </>
          )}
        </section>

        {page.components.length > 0 && (
          <section className="flex flex-col gap-1 max-w-3xl" data-testid="validation-components">
            <p className="section-label">{t('validation.components')}</p>
            <table className="text-xs border-collapse">
              <tbody>
                {page.components.map(c => (
                  <tr key={c.name} className="border-b border-edge-subtle">
                    <td className="py-1 pr-4 text-ink-2 w-48">{c.label}</td>
                    <td className="py-1 pr-4 text-ink-2">{c.version ? `${c.version.title} (${c.version.id})` : '—'}</td>
                    <td className="py-1">
                      {c.validation ? (
                        <button type="button" className={`px-1.5 rounded text-[10px] ${VALIDATION_STATE_BADGE[c.validation.state]}`}
                          onClick={() => void navigate({ to: '/validation/$validationId', params: { validationId: c.validation!.id }, search: { projectId, repoPath: c.repoPath } })}>
                          {t(`validation.state.${c.validation.state}`)}
                        </button>
                      ) : <span className="text-ink-3">{t('validation.noValidation')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {typeDef.fields.length > 0 && (
          <section className="flex flex-col gap-3 max-w-3xl">
            {typeDef.fields.map(f => (
              <DynamicField key={f.name} field={f} value={fieldValueToText(fields[f.name])} disabled={!editable} repoPath={repoPath}
                onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))} />
            ))}
            {editable && fieldsDirty && (
              <div className="flex gap-2">
                <button type="button" className="btn-primary-sm" data-testid="validation-save-fields" onClick={() => void run(() => api.validations.update(repoPath, validation.id, { fields }, workspaceDir))}>{t('common.save')}</button>
                <button type="button" className="btn-secondary-sm" onClick={() => setFields(validation.fields)}>{t('common.cancel')}</button>
              </div>
            )}
          </section>
        )}

        <ValidationGrid page={page} repoPath={repoPath} projectId={projectId} workspaceDir={workspaceDir} />
      </div>
      {confirming && (
        <ConfirmDialog
          action={confirming}
          problems={confirming === 'sign' ? page.problems : []}
          versionTitle={version.title}
          signed={state === 'signed'}
          onConfirm={() => void confirmAction()}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  )
}

function ConfirmDialog({ action, problems, versionTitle, signed, onConfirm, onClose }: {
  action: Exclude<Confirming, null>
  problems: ValidationProblem[]
  versionTitle: string
  signed: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const blocked = problems.length > 0
  useModalHotkeys(onClose, blocked ? undefined : onConfirm)
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" {...backdropDismiss(onClose)}>
      <div role="dialog" aria-label={t(`validation.confirmDialog.${action}.title`)} className="bg-surface border border-edge rounded-lg shadow-xl w-[30rem] max-w-[95vw] p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()} data-testid="validation-confirm-dialog">
        <h2 className="text-sm font-semibold text-ink">{t(`validation.confirmDialog.${action}.title`)}</h2>
        {blocked ? (
          <div className="flex flex-col gap-2 text-xs" data-testid="validation-problems">
            <p className="text-ink-2">{t('validation.problems.intro')}</p>
            <ul className="list-disc pl-4 text-status-danger">
              {problems.map(p => (
                <li key={p.code} data-testid={`validation-problem-${p.code}`}>
                  {t(`validation.problems.${p.code}`)}{p.ids.length > 0 && ` : ${p.ids.join(', ')}`}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-ink-2">{t(`validation.confirmDialog.${action}.${action === 'cancel' && signed ? 'textSigned' : 'text'}`, { version: versionTitle })}</p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary-sm" onClick={onClose} data-testid="validation-dialog-close">{t('common.cancel')}</button>
          {!blocked && <button type="button" className={action === 'sign' ? 'btn-primary-sm' : 'btn-danger-sm'} onClick={onConfirm} data-testid="validation-dialog-confirm">{t(`validation.confirmDialog.${action}.button`)}</button>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
