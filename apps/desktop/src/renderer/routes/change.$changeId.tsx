import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { fieldValueToText, flattenSystemNodes, isFieldRequiredNow, objectFieldReader, type UpdateChangeDto } from '@polenta/types'
import { api } from '../api'
import { ViewHeader } from '../components/layout/ViewHeader'
import { DynamicField } from '../components/DynamicField'
import { RichTextViewer } from '../components/RichTextViewer'
import { LinkList } from '../components/links/LinkList'
import { RichTextProvider } from '../contexts/RichTextContext'
import { HistorySection } from '../components/history/HistorySection'
import { ElementPickerModal, ImpactedList, ToModifyList, useRepoElements } from '../components/changes/ChangeElements'
import { useProjectSchema, getChangeTypeDef } from '../hooks/useProjectSchema'
import { useModalHotkeys } from '../hooks/useModalHotkeys'
import { useRegisterTabDirty, useSetTabTitle } from '../contexts/TabsContext'

/** GH198 — page d'un change (specs/GH198.md §5). URL : /change/<ID>?projectId=…&repoPath=<repo de stockage> */
export const Route = createFileRoute('/change/$changeId')({
  component: ChangePage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: (s['repoPath'] as string) ?? '',
  }),
})

function ChangePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { changeId } = Route.useParams()
  const { projectId, repoPath } = Route.useSearch()
  const [editingFields, setEditingFields] = useState<Record<string, string> | null>(null)
  const [reopenedOpen, setReopenedOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useRegisterTabDirty(editingFields !== null)

  const { data: change, isLoading, error: loadError } = useQuery({
    queryKey: ['change', repoPath, changeId],
    queryFn: () => api.changes.get(repoPath, changeId),
    enabled: !!repoPath,
  })
  useSetTabTitle(change ? `${change.id} ${change.title}` : changeId)
  const { data: schema } = useProjectSchema(repoPath)
  const typeDef = getChangeTypeDef(schema, change?.objectTypeRef)
  const elements = useRepoElements(repoPath, schema)

  const update = useMutation({
    mutationFn: (dto: UpdateChangeDto) => api.changes.update(repoPath, changeId, dto),
    onSuccess: saved => {
      qc.setQueryData(['change', repoPath, changeId], (prev: typeof change) => ({ ...prev, ...saved }))
      qc.invalidateQueries({ queryKey: ['changes'] })
      setEditingFields(null)
    },
  })
  const remove = useMutation({
    mutationFn: () => api.changes.delete(repoPath, changeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['changes'] })
      navigate({ to: '/changes', search: { projectId } })
    },
    onSettled: () => setConfirmDelete(false),
  })
  const { data: reopened = [], isFetching: reopenedLoading } = useQuery({
    queryKey: ['change-reopened', repoPath, changeId, change?.toModify.length],
    queryFn: () => api.changes.reopenedCandidates(repoPath, changeId),
    enabled: reopenedOpen && !!change,
  })

  if (isLoading || !change) {
    return <p className="p-8 text-sm text-ink-3">{loadError ? t('changes.notFound') : t('common.loading')}</p>
  }

  const statuses = typeDef?.statuses ?? []
  const atInitial = !statuses.length || change.status === statuses[0].name
  const nodes = flattenSystemNodes(schema?.nodes ?? []).map(({ node }) => node).filter(n => n.objectTypes !== undefined)
  const componentLabel = (name: string) => nodes.find(n => n.name === name)?.label || name
  const fieldText = (key: string) => fieldValueToText(change.fields?.[key])
  const startEditingFields = () => setEditingFields(Object.fromEntries((typeDef?.fields ?? []).map(f => [f.name, fieldText(f.name)])))
  const saveFields = () => { if (editingFields && !update.isPending) update.mutate({ fields: editingFields }) }
  const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

  return (
    <RichTextProvider>
      <div className="flex flex-col h-full overflow-hidden" data-testid="change-page">
        <ViewHeader
          currentProjectId={projectId}
          title={change.title}
          subtitle={<span><span className="font-mono">{change.id}</span>{typeDef && <span className="ml-2 text-ink-3">{typeDef.label || typeDef.name}</span>}</span>}
          actions={
            <>
              <select
                className="text-xs bg-surface border border-edge rounded px-1.5 py-1 text-ink"
                value={change.status}
                disabled={update.isPending}
                aria-label={t('changes.status')}
                onChange={e => update.mutate({ status: e.target.value })}
                data-testid="change-status"
              >
                {!statuses.some(s => s.name === change.status) && <option value={change.status}>{change.status}</option>}
                {statuses.map(s => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
              </select>
              <button type="button" className="text-ink-3 hover:text-status-danger p-1" title={t('changes.delete')} onClick={() => setConfirmDelete(true)} data-testid="change-delete">
                <Trash2 size={14} />
              </button>
            </>
          }
        />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl p-6">
            {(update.error || remove.error) && (
              <p className="mb-3 text-sm text-status-danger" data-testid="change-error">{errorMessage(update.error ?? remove.error)}</p>
            )}

            <TitleEditor value={change.title} onCommit={title => update.mutate({ title })} disabled={update.isPending} />

            <div className="mb-4">
              <p className="text-sm font-medium text-ink mb-1">{t('changes.component')}</p>
              {atInitial && nodes.length > 1 ? (
                <select
                  className="text-sm bg-surface border border-edge rounded px-2 py-1 text-ink"
                  value={change.component}
                  onChange={e => update.mutate({ component: e.target.value })}
                  data-testid="change-component"
                >
                  {!nodes.some(n => n.name === change.component) && <option value={change.component}>{change.component}</option>}
                  {nodes.map(n => <option key={n.name} value={n.name}>{n.label || n.name}</option>)}
                </select>
              ) : (
                <p className="text-sm text-ink-2" title={atInitial ? undefined : t('changes.componentFrozen')}>{componentLabel(change.component)}</p>
              )}
            </div>

            {typeDef && typeDef.fields.length > 0 && (
              <div className="border rounded p-3 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">{typeDef.label ?? typeDef.name}</p>
                  {editingFields === null ? (
                    <button type="button" onClick={startEditingFields} className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover" data-testid="change-edit-fields">
                      <Pencil size={13} />
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEditingFields(null)} className="text-xs text-ink-3 hover:text-ink">{t('common.cancel')}</button>
                      <button type="button" onClick={saveFields} disabled={update.isPending} className="btn-primary-sm" data-testid="change-save-fields">{t('common.save')}</button>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {typeDef.fields.map(f => (
                    editingFields !== null ? (
                      <DynamicField
                        key={f.name}
                        field={f}
                        value={editingFields[f.name] ?? ''}
                        requiredNow={isFieldRequiredNow(f, objectFieldReader(typeDef, { status: change.status, fields: editingFields }))}
                        onChange={v => setEditingFields(prev => ({ ...(prev ?? {}), [f.name]: v }))}
                        repoPath={repoPath}
                        interfaceRoles={schema?.roles?.map(r => r.name)}
                        onSubmit={saveFields}
                      />
                    ) : (
                      <div key={f.name}>
                        <p className="text-sm font-medium text-ink mb-1">{f.label ?? f.name}</p>
                        {f.type === 'richtext' ? <RichTextViewer value={fieldText(f.name)} repoPath={repoPath} />
                          : f.type === 'link' ? (fieldText(f.name) ? <LinkList value={change.fields?.[f.name]} /> : <p className="text-sm text-ink-2">—</p>)
                          : <p className="text-sm text-ink-2">{fieldText(f.name) || '—'}</p>}
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            <ToModifyList
              items={change.toModify}
              onChange={toModify => update.mutate({ toModify })}
              onAddReopened={() => setReopenedOpen(true)}
              repoPath={repoPath}
              projectId={projectId}
              elements={elements}
              disabled={update.isPending}
            />
            <ImpactedList
              items={change.impacted}
              onChange={impacted => update.mutate({ impacted })}
              repoPath={repoPath}
              projectId={projectId}
              elements={elements}
              disabled={update.isPending}
            />

            {/* Origine, version intégrée, campagnes : alimentées par les lots suivants (L5, L6, L8). */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mb-4">
              <dt className="text-ink-3">{t('changes.origin')}</dt>
              <dd className="text-ink-2">{[...change.origin.runs, ...change.origin.decisions.map(d => `${d.conformityId} / ${d.objectId}`)].join(', ') || '—'}</dd>
              <dt className="text-ink-3">{t('changes.integratedIn')}</dt>
              <dd className="text-ink-2">{change.integratedIn || '—'}</dd>
              <dt className="text-ink-3">{t('changes.campaigns')}</dt>
              <dd className="text-ink-2">{change.campaigns.join(', ') || '—'}</dd>
            </dl>

            <HistorySection
              repoPath={repoPath}
              kind="change"
              id={change.id}
              typeDef={typeDef}
              refreshKey={JSON.stringify(change.history ?? null)}
            />
          </div>
        </div>

        {reopenedOpen && (
          <ElementPickerModal
            title={t('changes.reopenedTitle')}
            help={t('changes.reopenedHelp')}
            emptyLabel={reopenedLoading ? t('common.loading') : t('changes.reopenedNone')}
            candidates={reopened.map(c => ({ ...c, status: elements.get(c.id)?.status ?? c.status }))}
            onClose={() => setReopenedOpen(false)}
            onAdd={ids => {
              update.mutate({ toModify: [...change.toModify, ...ids.map(id => ({ id, state: 'planned' as const }))] })
              setReopenedOpen(false)
            }}
          />
        )}
        {confirmDelete && (
          <ConfirmDelete id={change.id} pending={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setConfirmDelete(false)} />
        )}
      </div>
    </RichTextProvider>
  )
}

/** Titre enregistré à la sortie du champ. */
function TitleEditor({ value, onCommit, disabled }: { value: string; onCommit: (v: string) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setDraft(value) }
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-ink mb-1">{t('changes.titleLabel')}</label>
      <input
        className="w-full text-sm bg-surface border border-edge rounded px-2 py-1.5 text-ink"
        value={draft}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { const v = draft.trim(); if (v && v !== value) onCommit(v); else setDraft(value) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        data-testid="change-title"
      />
    </div>
  )
}

function ConfirmDelete({ id, pending, onConfirm, onCancel }: { id: string; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  useModalHotkeys(onCancel, onConfirm, pending)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40" onClick={onCancel}>
      <div role="dialog" className="bg-surface border border-edge rounded-lg shadow-xl p-5 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <p className="text-sm text-ink mb-4">{t('changes.deleteConfirm', { id })}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="text-xs text-ink-3 hover:text-ink" onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="btn-danger-sm" disabled={pending} onClick={onConfirm} data-testid="change-delete-confirm">{t('changes.delete')}</button>
        </div>
      </div>
    </div>
  )
}
