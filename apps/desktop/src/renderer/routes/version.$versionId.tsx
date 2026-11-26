import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Lock, Plus, Tag } from 'lucide-react'
import type { UpdateVersionDto } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { PageLink } from '../components/element/PageLink'
import { useSetTabTitle } from '../contexts/TabsContext'
import { VersionChangesTable } from '../components/versions/VersionChangesTable'
import { VersionElementPicker } from '../components/versions/VersionElementPicker'
import { ReleaseVersionDialog } from '../components/versions/ReleaseVersionDialog'
import { STATE_BADGE, useInvalidateVersions, useSectionOpen, useVersionImpact, useVersionPage, useVersionTree, versionErrorText } from '../components/versions/useVersions'
import { VersionAnalysisSection } from '../components/versions/VersionAnalysisSection'
import { VersionTestsSection } from '../components/versions/VersionTestsSection'
import { VersionInfoSection } from '../components/versions/VersionInfoSection'
import { VersionExportButton } from '../components/versions/VersionExportButton'
import { VersionRequirementsSection } from '../components/versions/VersionRequirementsSection'
import { SectionToggle } from '../components/versions/SectionToggle'

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
  // GH245 — analyse d'impact et tests à exécuter (pas pour une version abandonnée).
  const impactQuery = useVersionImpact(repoPath, versionId, projectId, !!page && page.state !== 'abandoned')
  // Sections repliables, état mémorisé par poste (GH439 : « Informations » et « Exigences » s'y ajoutent).
  const [componentsOpen, setComponentsOpen] = useSectionOpen('components')
  const [changesOpen, setChangesOpen] = useSectionOpen('changes')
  // Repo de chaque composant (racines de l'analyse portées par un composant).
  const { data: tree } = useVersionTree(projectId)
  const repoOfComponent = useMemo(() => {
    const m = new Map<string, string>()
    const walk = (nodes: NonNullable<typeof tree>) => nodes.forEach(n => { m.set(n.name, n.repoPath); walk(n.children) })
    walk(tree ?? [])
    return m
  }, [tree])
  useSetTabTitle(page ? `${page.version.title} (${page.version.id})` : versionId)

  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [releasing, setReleasing] = useState(false)

  const editable = !!page && page.state === 'in_progress' && !page.component.readonly
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

  const { version, state } = page
  // Abandonnée avant tout passage released : aucun état figé à lire, la section Exigences n'existe pas.
  const hasRequirements = !(state === 'abandoned' && !version.freeze)

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="version-page">
      <ViewHeader
        currentProjectId={projectId}
        title={`${version.title} — ${page.component.label}`}
        subtitle={(
          <span className="flex items-center gap-2">
            {version.id}
            <span className={`px-1.5 rounded text-[10px] ${STATE_BADGE[state]}`} data-testid="version-state-short">{t(`versions.state.${state}`)}</span>
          </span>
        )}
        actions={
          <>
            <VersionExportButton page={page} repoPath={repoPath} projectId={projectId} versionId={versionId} />
            {page.component.readonly && <span title={t('versions.readonly')}><Lock size={13} className="text-status-warning" /></span>}
            {page.tagPending && <span className="text-xs text-status-warning" title={t('versions.tagPendingHelp')} data-testid="version-tag-pending">{t('versions.tagPending', { tag: version.freeze?.tag })}</span>}
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

        <VersionInfoSection page={page} repoPath={repoPath} projectId={projectId} editable={editable} onUpdate={update} />

        {page.components.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionToggle open={componentsOpen} onToggle={() => setComponentsOpen(o => !o)} label={t('versions.components')} count={page.components.length} testId="version-components-toggle" />
            {componentsOpen && <table className="text-xs border-collapse max-w-3xl" data-testid="version-components">
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
                        <PageLink id={c.selected.id} repoPath={c.repoPath} className="text-prim"
                          onFallback={() => void navigate({ to: '/version/$versionId', params: { versionId: c.selected!.id }, search: { projectId, repoPath: c.repoPath } })}>
                          {c.selected.title} ({c.selected.id}){c.selected.state === 'abandoned' && ` — ${t('versions.state.abandoned')}`}
                        </PageLink>
                      ) : <span className="text-ink-3">{t('versions.none')}</span>}
                      {c.selected && <span className={`ml-2 px-1.5 rounded text-[10px] ${STATE_BADGE[c.selected.state]}`}>{t(`versions.state.${c.selected.state}`)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
          </section>
        )}

        {/* Une alerte ne se replie pas : visible même sous une section « Composants » fermée. */}
        <OrphanComponents
          entries={Object.entries(version.components ?? {}).filter(([name]) => !page.components.some(c => c.name === name))}
          editable={editable}
          onRemove={name => void update({ components: Object.fromEntries(Object.entries(version.components ?? {}).filter(([n]) => n !== name)) })}
        />

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <SectionToggle open={changesOpen} onToggle={() => setChangesOpen(o => !o)} label={t('versions.page.changes')} count={page.rows.length} testId="version-changes-toggle" />
            {editable && changesOpen && (
              <button type="button" onClick={() => setPicking(true)} className="btn-secondary-sm flex items-center gap-1" data-testid="version-add">
                <Plus size={12} />{t('versions.page.add')}
              </button>
            )}
          </div>
          {changesOpen && (
            <VersionChangesTable
              rows={page.rows}
              repoPath={repoPath}
              projectId={projectId}
              title={`${t('versions.page.changes')} ${version.title}`}
              onRemove={editable ? ids => void run(() => api.versions.removeChanges(repoPath, versionId, ids, workspaceDir || undefined)) : undefined}
            />
          )}
        </section>

        {state !== 'abandoned' && (
          <>
            <VersionAnalysisSection
              analysis={impactQuery.data?.analysis}
              isFetching={impactQuery.isFetching}
              onRefresh={() => void impactQuery.refetch()}
              onSetImpact={(elementId, status, comment) => run(() => api.versions.setImpact(repoPath, versionId, elementId, status, comment, workspaceDir || undefined))}
              repoPath={repoPath}
              repoOfComponent={repoOfComponent}
              editable={editable}
            />
            <VersionTestsSection data={impactQuery.data?.tests ?? undefined} repoPath={repoPath} projectId={projectId} versionLabel={`${version.id} — ${version.title}`} />
          </>
        )}

        {hasRequirements && (
          <VersionRequirementsSection repoPath={repoPath} projectId={projectId} versionId={versionId} versionLabel={`${version.id} — ${version.title}`} />
        )}
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

/** GH268 — composants retirés de la structure : leur entrée bloque le passage released, sans ce moyen de la retirer. */
function OrphanComponents({ entries, editable, onRemove }: { entries: Array<[string, string]>; editable: boolean; onRemove: (name: string) => void }) {
  const { t } = useTranslation()
  if (entries.length === 0) return null
  return (
    <section className="flex flex-col gap-1 text-xs" data-testid="version-orphan-components">
      <p className="text-status-warning">{t('versions.orphans.title')}</p>
      {entries.map(([name, id]) => (
        <div key={name} className="flex items-center gap-2">
          <span className="text-ink-2">{name} : {id}</span>
          {editable && <button type="button" className="btn-secondary-sm" onClick={() => onRemove(name)} data-testid={`version-orphan-remove-${name}`}>{t('versions.orphans.remove')}</button>}
        </div>
      ))}
    </section>
  )
}
