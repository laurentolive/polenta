import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { fieldValueToText, flattenSystemNodes, isFieldRequiredNow, objectFieldReader, type ChangeImpactRow, type ChangeImpactStatus, type UpdateChangeDto } from '@polenta/types'
import { api } from '../api'
import { ViewHeader } from '../components/layout/ViewHeader'
import { DynamicField } from '../components/DynamicField'
import { RichTextViewer } from '../components/RichTextViewer'
import { LinkList } from '../components/links/LinkList'
import { RichTextProvider } from '../contexts/RichTextContext'
import { HistorySection } from '../components/history/HistorySection'
import { ImpactedList, ToModifyList, useRepoElements } from '../components/changes/ChangeElements'
import { ChangeAnalysisSection } from '../components/changes/ChangeAnalysisSection'
import { decodeProjectId } from '../lib/projectId'
import { useProjectSchema, getChangeTypeDef } from '../hooks/useProjectSchema'
import { useModalHotkeys } from '../hooks/useModalHotkeys'
import { useRegisterTabDirty, useSetTabTitle } from '../contexts/TabsContext'

/** GH198 — page d'un change (specs/GH198.md §5). URL : /change/<ID>?projectId=…&repoPath=<repo de stockage> */
export const Route = createFileRoute('/changeset/$changeId')({
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  useRegisterTabDirty(editingFields !== null)

  const { data: change, isLoading, error: loadError } = useQuery({
    queryKey: ['changeset', repoPath, changeId],
    queryFn: () => api.changesets.get(repoPath, changeId),
    enabled: !!repoPath,
  })
  useSetTabTitle(change ? `${change.id} ${change.title}` : changeId)
  const { data: schema } = useProjectSchema(repoPath)
  const typeDef = getChangeTypeDef(schema, change?.objectTypeRef)
  const elements = useRepoElements(repoPath, schema)

  const update = useMutation({
    mutationFn: (dto: UpdateChangeDto) => api.changesets.update(repoPath, changeId, dto),
    onSuccess: saved => {
      qc.setQueryData(['changeset', repoPath, changeId], (prev: typeof change) => ({ ...prev, ...saved }))
      qc.invalidateQueries({ queryKey: ['changesets'] })
      qc.invalidateQueries({ queryKey: ['change-analysis', repoPath, changeId] })
      qc.invalidateQueries({ queryKey: ['changes-backlog'] })
      setEditingFields(null)
    },
  })
  // GH199 §8bis — autres changes ouverts du repo qui listent un élément « à modifier ».
  const { data: repoChanges = [] } = useQuery({
    queryKey: ['changesets', 'repo', repoPath],
    queryFn: () => api.changesets.list(repoPath),
    enabled: !!repoPath,
  })
  const alsoIn = new Map<string, string[]>()
  for (const c of repoChanges) {
    if (c.id === changeId || c.repoPath !== repoPath || !c.open) continue
    for (const id of c.toModifyIds) alsoIn.set(id, [...(alsoIn.get(id) ?? []), c.id])
  }
  // GH199 — analyse d'impact (live ; instantané figé au statut terminal).
  const analysisQuery = useQuery({
    queryKey: ['change-analysis', repoPath, changeId],
    queryFn: () => api.changesets.analysis(repoPath, changeId),
    enabled: !!repoPath,
  })
  const remove = useMutation({
    mutationFn: () => api.changesets.delete(repoPath, changeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['changesets'] })
      navigate({ to: '/changesets', search: { projectId } })
    },
    onSettled: () => setConfirmDelete(false),
  })
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''

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
  // Lignes des impactés : celles de l'analyse (déclarées + calculées) ; à défaut, les déclarées.
  const frozen = !!analysisQuery.data?.frozen
  const impactRows: ChangeImpactRow[] = analysisQuery.data?.rows
    ?? change.impacted.map(i => ({ id: i.id, elementType: null, title: null, status: i.status, ...(i.comment && { comment: i.comment }), source: i.source, reached: true }))
  // Statut d'un élément (ligne de la liste ou nœud d'arbre) : ligne existante mise à jour, sinon
  // ligne calculée ajoutée ; le main n'écrit que les lignes portant une saisie (Q2).
  const setImpact = (id: string, status: ChangeImpactStatus, comment: string | undefined) => {
    const exists = change.impacted.some(i => i.id === id)
    update.mutate({
      impacted: exists
        ? change.impacted.map(i => (i.id === id ? { ...i, status, comment } : i))
        : [...change.impacted, { id, status, comment, source: 'computed' as const }],
    })
  }
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

            <div className="mb-4 flex items-center gap-3">
              <p className="text-sm font-medium text-ink w-40 shrink-0">{t('changes.component')}</p>
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
              <div className="relative border rounded p-3 mb-4">
                {/* Boutons d'édition dans le coin, au niveau du libellé du premier champ (pas de titre de section). */}
                {editingFields === null && (
                  <div className="absolute top-2 right-3">
                    <button type="button" onClick={startEditingFields} className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover" data-testid="change-edit-fields">
                      <Pencil size={13} />
                    </button>
                  </div>
                )}
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
                      // Un clic sur un champ ouvre l'édition, comme le titre.
                      <div key={f.name} role="button" tabIndex={0} title={t('changes.clickToEdit')} data-testid={`change-field-${f.name}`}
                        className="cursor-text rounded -mx-1 px-1 hover:bg-hover"
                        onClick={e => { if (!(e.target as HTMLElement).closest('a')) startEditingFields() }}
                        onKeyDown={e => { if (e.key === 'Enter') startEditingFields() }}>
                        <p className="text-sm font-medium text-ink mb-1">{f.label ?? f.name}</p>
                        {f.type === 'richtext' ? <RichTextViewer value={fieldText(f.name)} repoPath={repoPath} />
                          : f.type === 'link' ? (fieldText(f.name) ? <LinkList value={change.fields?.[f.name]} /> : <p className="text-sm text-ink-2">—</p>)
                          : <p className="text-sm text-ink-2">{fieldText(f.name) || '—'}</p>}
                      </div>
                    )
                  ))}
                </div>
                {editingFields !== null && (
                  <div className="flex justify-end items-center gap-3 mt-3">
                    <button type="button" onClick={() => setEditingFields(null)} className="text-xs text-ink-3 hover:text-ink">{t('common.cancel')}</button>
                    <button type="button" onClick={saveFields} disabled={update.isPending} className="btn-primary-sm" data-testid="change-save-fields">{t('common.save')}</button>
                  </div>
                )}
              </div>
            )}

            {/* Origine, version intégrée, campagnes : alimentées par les lots suivants (L5, L6, L8). */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mb-4">
              <dt className="text-ink-3">{t('changes.origin')}</dt>
              <dd className="text-ink-2">{[...change.origin.runs, ...change.origin.decisions.map(d => `${d.conformityId} / ${d.objectId}`)].join(', ') || '—'}</dd>
              <dt className="text-ink-3">{t('changes.integratedIn')}</dt>
              <dd className="text-ink-2">{change.integratedIn || '—'}</dd>
              <dt className="text-ink-3">{t('changes.campaigns')}</dt>
              <dd className="text-ink-2">{change.campaigns.join(', ') || '—'}</dd>
            </dl>

            <ToModifyList
              items={change.toModify}
              onChange={toModify => update.mutate({ toModify })}
              changeId={change.id}
              component={change.component}
              alsoIn={alsoIn}
              repoPath={repoPath}
              projectId={projectId}
              workspaceDir={workspaceDir}
              elements={elements}
              disabled={update.isPending}
            />
            <ImpactedList
              rows={impactRows}
              onSetImpact={setImpact}
              onAddDeclared={ids => update.mutate({ impacted: [...change.impacted, ...ids.map(id => ({ id, status: 'impact_non_verifie' as const, source: 'declared' as const }))] })}
              onRemoveDeclared={id => update.mutate({ impacted: change.impacted.filter(i => i.id !== id) })}
              onPromote={id => update.mutate({
                toModify: [...change.toModify, { id, state: 'planned' }],
                impacted: change.impacted.filter(i => i.id !== id),
              })}
              repoPath={repoPath}
              projectId={projectId}
              workspaceDir={workspaceDir}
              elements={elements}
              disabled={update.isPending || frozen}
            />

            <ChangeAnalysisSection
              change={change}
              analysis={analysisQuery.data}
              isFetching={analysisQuery.isFetching}
              onRefresh={() => analysisQuery.refetch()}
              onSetImpact={setImpact}
              repoPath={repoPath}
              projectId={projectId}
              disabled={update.isPending}
            />

            <HistorySection
              repoPath={repoPath}
              kind="changeset"
              id={change.id}
              typeDef={typeDef}
              refreshKey={JSON.stringify(change.history ?? null)}
              framed
            />
          </div>
        </div>

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
    <div className="mb-4 flex items-center gap-3">
      <label className="text-sm font-medium text-ink w-40 shrink-0">{t('changes.titleLabel')}</label>
      <input
        className="flex-1 min-w-0 text-sm bg-surface border border-edge rounded px-2 py-1.5 text-ink"
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
