import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Lock, Plus, Tag } from 'lucide-react'
import type { UpdateVersionDto } from '@polenta/types'
import { fieldValueToText } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { DynamicField } from '../components/DynamicField'
import { useSetTabTitle } from '../contexts/TabsContext'
import { VersionChangesTable } from '../components/versions/VersionChangesTable'
import { VersionElementPicker } from '../components/versions/VersionElementPicker'
import { ReleaseVersionDialog } from '../components/versions/ReleaseVersionDialog'
import { STATE_BADGE, statusLabel, useInvalidateVersions, useVersionPage, versionErrorText } from '../components/versions/useVersions'

/** GH201 §5 — page d'une version. URL : /version/<ID>?projectId=…&repoPath=… */
export const Route = createFileRoute('/version/$versionId')({
  component: VersionPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: (s['repoPath'] as string) ?? '',
  }),
})

function VersionPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { versionId } = Route.useParams()
  const { projectId, repoPath } = Route.useSearch()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  const { data: page, error: loadError, isLoading } = useVersionPage(repoPath, versionId, projectId)
  const invalidate = useInvalidateVersions()
  useSetTabTitle(page ? `${page.version.title} (${page.version.id})` : versionId)

  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [releasing, setReleasing] = useState(false)
  useEffect(() => {
    if (!page) return
    setTitle(page.version.title)
    setFields(page.version.fields ?? {})
  }, [page])

  const editable = !!page && page.state === 'in_progress' && !page.component.readonly
  const fieldsDirty = !!page && JSON.stringify(fields) !== JSON.stringify(page.version.fields ?? {})
  const included = useMemo(() => new Set((page?.version.changes ?? []).map(c => c.id)), [page])

  const run = async (op: () => Promise<unknown>) => {
    setError(null)
    try {
      await op()
      await invalidate()
    } catch (err) {
      setError(versionErrorText(t, err))
    }
  }
  const update = (dto: UpdateVersionDto) => run(() => api.versions.update(repoPath, versionId, dto, workspaceDir || undefined))

  if (isLoading) return <p className="p-4 text-xs text-ink-3 italic">{t('common.loading')}</p>
  if (!page) return <p className="p-4 text-xs text-status-danger">{loadError ? versionErrorText(t, loadError) : versionId}</p>

  const { version, typeDef, state } = page
  // Statuts proposés : jamais le statut released (passage dédié) ; une version figée ne propose que l'abandon.
  const statusOptions = (typeDef.statuses ?? []).filter(s => s.name === version.status || (!s.isApproval && (!version.freeze || s.isTerminal)))

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="version-page">
      <ViewHeader
        currentProjectId={projectId}
        title={`${version.title} — ${page.component.label}`}
        subtitle={version.id}
        actions={
          <>
            {page.component.readonly && <span title={t('versions.readonly')}><Lock size={13} className="text-status-warning" /></span>}
            {editable && (
              <button type="button" onClick={() => setReleasing(true)} className="btn-primary-sm flex items-center gap-1.5" data-testid="version-release">
                <Tag size={12} />{t('versions.release.button')}
              </button>
            )}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        {error && <p className="text-xs text-status-danger" role="alert">{error}</p>}

        <section className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-xs items-center max-w-3xl">
          <span className="text-ink-3">{t('versions.label')}</span>
          {editable ? (
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() && title !== version.title) void update({ title }) }}
              className="input-field text-sm max-w-xs"
              data-testid="version-title"
            />
          ) : <span className="text-sm text-ink">{version.title}</span>}

          <span className="text-ink-3">{t('versions.status')}</span>
          <span className="flex items-center gap-2">
            <span className={`px-1.5 rounded text-[10px] ${STATE_BADGE[state]}`}>{t(`versions.state.${state}`)}</span>
            {!page.component.readonly && statusOptions.length > 1 ? (
              <select value={version.status} onChange={e => void update({ status: e.target.value })} className="input-field text-xs" data-testid="version-status">
                {statusOptions.map(s => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
              </select>
            ) : <span className="text-ink">{statusLabel(typeDef, version.status)}</span>}
          </span>

          <span className="text-ink-3">{t('versions.basedOn')}</span>
          {editable ? (
            <select value={version.basedOn ?? ''} onChange={e => void update({ basedOn: e.target.value || null })} className="input-field text-xs max-w-xs" data-testid="version-based-on">
              <option value="">{t('versions.none')}</option>
              {page.basedOnOptions.map(v => <option key={v.id} value={v.id}>{v.title} ({v.id})</option>)}
            </select>
          ) : page.basedOn ? (
            <button type="button" className="text-prim hover:underline text-left" onClick={() => void navigate({ to: '/version/$versionId', params: { versionId: page.basedOn!.id }, search: { projectId, repoPath } })}>
              {page.basedOn.title} ({page.basedOn.id})
            </button>
          ) : <span className="text-ink-3">{t('versions.none')}</span>}

          {version.freeze && (
            <>
              <span className="text-ink-3">{t('versions.release.tag')}</span>
              <span className="font-mono text-ink">{version.freeze.tag} <span className="text-ink-3">@ {version.freeze.sha.slice(0, 7)}</span></span>
            </>
          )}
        </section>

        {(typeDef.fields ?? []).length > 0 && (
          <section className="flex flex-col gap-3 max-w-3xl">
            {(typeDef.fields ?? []).map(f => (
              <DynamicField
                key={f.name}
                field={f}
                value={fieldValueToText(fields[f.name])}
                onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))}
                disabled={!editable}
                repoPath={repoPath}
              />
            ))}
            {editable && fieldsDirty && (
              <div className="flex gap-2">
                <button type="button" onClick={() => void update({ fields })} className="btn-primary-sm" data-testid="version-save-fields">{t('common.save')}</button>
                <button type="button" onClick={() => setFields(version.fields ?? {})} className="btn-secondary-sm">{t('common.cancel')}</button>
              </div>
            )}
          </section>
        )}

        {page.components.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="section-label">{t('versions.components')}</h3>
            <table className="text-xs border-collapse max-w-3xl" data-testid="version-components">
              <tbody>
                {page.components.map(c => (
                  <tr key={c.name} className="border-b border-edge-subtle">
                    <td className="py-1 pr-4 text-ink-2 w-48">{c.label}</td>
                    <td className="py-1">
                      {!c.versionType ? (
                        <span className="text-ink-3 italic">{t('versions.noType')}</span>
                      ) : editable ? (
                        <select
                          value={c.selected?.id ?? ''}
                          onChange={e => void update({ components: { ...version.components, [c.name]: e.target.value } })}
                          className="input-field text-xs"
                          data-testid={`version-component-${c.name}`}
                        >
                          <option value="">{t('versions.none')}</option>
                          {c.options.map(o => <option key={o.id} value={o.id}>{o.title} ({o.id}) — {t(`versions.state.${o.state}`)}</option>)}
                        </select>
                      ) : c.selected ? (
                        <button type="button" className="text-prim hover:underline" onClick={() => void navigate({ to: '/version/$versionId', params: { versionId: c.selected!.id }, search: { projectId, repoPath: c.repoPath } })}>
                          {c.selected.title} ({c.selected.id})
                        </button>
                      ) : <span className="text-ink-3">{t('versions.none')}</span>}
                      {c.selected && <span className={`ml-2 px-1.5 rounded text-[10px] ${STATE_BADGE[c.selected.state]}`}>{t(`versions.state.${c.selected.state}`)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h3 className="section-label">{t('versions.page.changes')}</h3>
            {editable && (
              <button type="button" onClick={() => setPicking(true)} className="btn-secondary-sm flex items-center gap-1" data-testid="version-add">
                <Plus size={12} />{t('versions.page.add')}
              </button>
            )}
          </div>
          <VersionChangesTable
            rows={page.rows}
            projectId={projectId}
            onRemove={editable ? id => void run(() => api.versions.removeChanges(repoPath, versionId, [id], workspaceDir || undefined)) : undefined}
          />
        </section>
      </div>

      {picking && (
        <VersionElementPicker
          repoPath={repoPath}
          workspaceDir={workspaceDir}
          excluded={included}
          onClose={() => setPicking(false)}
          onAdd={ids => { setPicking(false); void run(() => api.versions.include(repoPath, versionId, ids, workspaceDir || undefined)) }}
        />
      )}
      {releasing && <ReleaseVersionDialog repoPath={repoPath} version={version} workspaceDir={workspaceDir} onClose={() => setReleasing(false)} />}
    </div>
  )
}
