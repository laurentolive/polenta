import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileDiff, Inbox, Plus, Sparkles } from 'lucide-react'
import type { ChangeSummary, ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { getChangeTypeDef } from '../../hooks/useProjectSchema'
import { useLocalImpactAnalysis } from '../../hooks/useLocalImpactAnalysis'
import { useFlaggedElements } from '../../hooks/useFlaggedElements'
import { useBacklog } from '../../hooks/useBacklog'
import { ComponentTypeCombobox } from '../system/ComponentTypeCombobox'
import type { ComponentTypeOption } from '../../contexts/SystemViewContext'

interface Props {
  projectId: string
}

/** Nom affiché d'un repo : dernier segment du chemin. */
export function repoName(repoPath: string): string {
  return repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath
}

/** GH199 — composant affiché, mémorisé par projet (comme la sélection des vues Exigences / Tests). */
interface SelectedComponent { repoPath: string; component: string }
const selectionKey = (projectId: string) => `polenta:changesetsComponent:${projectId}`
function readSelection(projectId: string): SelectedComponent | null {
  try {
    const v = JSON.parse(localStorage.getItem(selectionKey(projectId)) ?? 'null')
    return typeof v?.repoPath === 'string' && typeof v?.component === 'string' ? v : null
  } catch {
    return null
  }
}
function writeSelection(projectId: string, sel: SelectedComponent): void {
  try { localStorage.setItem(selectionKey(projectId), JSON.stringify(sel)) } catch { /* best effort */ }
}

/**
 * GH198 — panneau de la vue Changesets (specs/GH198.md §5), changesets triés par ID décroissant ;
 * filtres type / statut / mes changesets / masquer les terminés.
 * GH199 — comme les vues Exigences / Tests / Campagnes, une liste déroulante choisit le composant
 * affiché : son backlog et ses seuls changesets. Reprend aussi les entrées de l'ancienne vue Analyse
 * d'impact : « Impact à vérifier », « Modifications locales » et la Constellation.
 */
export function ChangesPanel({ projectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const workspaceDir = decodeProjectId(projectId)
  const { activeId, activeRepo, pathname, searchStr } = useRouterState({
    select: s => ({
      pathname: s.location.pathname,
      searchStr: s.location.searchStr,
      activeId: s.location.pathname.startsWith('/changeset/') ? decodeURIComponent(s.location.pathname.slice('/changeset/'.length)) : null,
      activeRepo: new URLSearchParams(s.location.searchStr).get('repoPath'),
    }),
  })

  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [mine, setMine] = useState(false)
  const [hideTerminal, setHideTerminal] = useState(true)

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''
  const { data: changes = [] } = useQuery({
    queryKey: ['changesets', workspaceDir, repoPath],
    queryFn: () => api.changesets.list(repoPath, workspaceDir || undefined),
    enabled: !!repoPath,
  })
  const allBacklogs = useBacklog(projectId).data ?? []
  const multiRepo = new Set(allBacklogs.map(b => b.repoPath)).size > 1
  const options: ComponentTypeOption[] = allBacklogs.map(b => ({
    repoName: b.repoPath, nodeId: b.component, typeId: '', label: b.label,
    ...(multiRepo && { groupLabel: repoName(b.repoPath) }),
  }))
  const [chosen, setChosen] = useState<SelectedComponent | null>(() => readSelection(projectId))
  const indexOf = (sel: SelectedComponent | null) => sel ? allBacklogs.findIndex(b => b.repoPath === sel.repoPath && b.component === sel.component) : -1
  const selectedIndex = indexOf(chosen) >= 0 ? indexOf(chosen) : Math.max(0, allBacklogs.findIndex(b => b.repoPath === repoPath))
  const selectedBacklog = allBacklogs[selectedIndex]
  const selected: SelectedComponent | null = selectedBacklog ? { repoPath: selectedBacklog.repoPath, component: selectedBacklog.component } : null
  const select = (sel: SelectedComponent) => { setChosen(sel); writeSelection(projectId, sel) }
  const { data: me } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath && mine,
  })

  // Types et statuts : lus dans le schéma du repo de stockage de chaque change.
  const repos = useMemo(() => [...new Set(changes.map(c => c.repoPath))], [changes])
  const schemas = useQueries({
    queries: repos.map(rp => ({ queryKey: ['schema', rp], queryFn: () => api.schema.get(rp), staleTime: Infinity })),
  })
  const schemaByRepo = new Map<string, ProjectSchema | undefined>(repos.map((rp, i) => [rp, schemas[i]?.data]))
  const typeOf = (c: ChangeSummary): ObjectTypeDefinition | undefined => getChangeTypeDef(schemaByRepo.get(c.repoPath), c.objectTypeRef)
  const isTerminal = (c: ChangeSummary) => !!typeOf(c)?.statuses?.find(s => s.name === c.status)?.isTerminal
  const statusLabel = (c: ChangeSummary) => typeOf(c)?.statuses?.find(s => s.name === c.status)?.label || c.status

  const typeOptions = [...new Map(changes.map(c => [c.objectTypeRef, typeOf(c)?.label || c.objectTypeRef])).entries()]
  const statusOptions = [...new Map(changes.map(c => [c.status, statusLabel(c)])).entries()]

  const visible = changes.filter(c =>
    (!typeFilter || c.objectTypeRef === typeFilter)
    && (!statusFilter || c.status === statusFilter)
    && (!selected || (c.repoPath === selected.repoPath && c.component === selected.component))
    && (!mine || (!!me && c.createdBy === me))
    && (!hideTerminal || !isTerminal(c)))

  useEffect(() => {
    const current = changes.find(c => c.id === activeId && c.repoPath === activeRepo)
    if (current && (current.repoPath !== selected?.repoPath || current.component !== selected?.component)) {
      select({ repoPath: current.repoPath, component: current.component })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRepo, changes])

  const open = (c: ChangeSummary) =>
    navigate({ to: '/changeset/$changeId', params: { changeId: c.id }, search: { projectId, repoPath: c.repoPath } })
  const selectClass = 'w-full text-xs bg-surface border border-edge rounded px-1.5 py-1 text-ink'

  // GH199 — entrées live, affichées seulement quand elles ont du contenu (compteur).
  const flaggedCount = useFlaggedElements(projectId).data?.length ?? 0
  const localCount = useLocalImpactAnalysis(projectId).data?.changedRequirements.length ?? 0
  const backlogSearch = new URLSearchParams(searchStr)
  const entryClass = (active: boolean) =>
    `w-full flex items-center gap-2 px-4 py-1.5 text-xs text-left border-b border-edge-subtle ${active ? 'bg-hover text-prim font-medium' : 'text-ink-2 hover:bg-hover'}`

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="changes-panel">
      <div className="px-4 py-3 border-b border-edge shrink-0 flex items-center justify-between gap-2">
        <p className="section-label">{t('changes.title')}</p>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => navigate({ to: '/constellation', search: { projectId } })}
          className={pathname === '/constellation' ? 'text-ink' : 'text-ink-3 hover:text-ink'}
          title={t('constellation.openFromPanel')}
          data-testid="changes-constellation"
        >
          <Sparkles size={14} />
        </button>
        <button
          type="button"
          onClick={() => navigate({ to: '/changeset/new', search: { projectId, repoPath: selected?.repoPath, element: undefined, component: selected?.component } })}
          className="text-ink-3 hover:text-ink"
          title={t('changes.new')}
          data-testid="changes-new"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="px-3 py-2 border-b border-edge shrink-0" data-testid="changes-component">
        <ComponentTypeCombobox
          options={options}
          selectedIndex={selectedBacklog ? selectedIndex : -1}
          onSelect={opt => select({ repoPath: opt.repoName, component: opt.nodeId })}
        />
      </div>
      {flaggedCount > 0 && (
        <button type="button" onClick={() => navigate({ to: '/changesets/revalidation', search: { projectId } })}
          className={entryClass(pathname === '/changesets/revalidation')} data-testid="changes-revalidation-entry">
          <AlertTriangle size={13} className="shrink-0 text-status-warning" />
          <span className="flex-1 truncate">{t('impactAnalysisPage.revalidation.listTitle')}</span>
          <span className="text-ink-3">{flaggedCount}</span>
        </button>
      )}
      {localCount > 0 && (
        <button type="button" onClick={() => navigate({ to: '/changesets/local', search: { projectId } })}
          className={entryClass(pathname === '/changesets/local')} data-testid="changes-local-entry">
          <FileDiff size={13} className="shrink-0" />
          <span className="flex-1 truncate">{t('impactAnalysisPage.localTitle')}</span>
          <span className="text-ink-3">{localCount}</span>
        </button>
      )}
      {selectedBacklog && (() => {
        const b = selectedBacklog
        const active = pathname === '/changesets/backlog' && backlogSearch.get('repoPath') === b.repoPath && backlogSearch.get('component') === b.component
        return (
          <button type="button"
            onClick={() => navigate({ to: '/changesets/backlog', search: { projectId, repoPath: b.repoPath, component: b.component } })}
            className={entryClass(active)} data-testid={`changes-backlog-entry-${repoName(b.repoPath)}-${b.component}`}>
            <Inbox size={13} className="shrink-0" />
            <span className="flex-1 truncate">{t('changes.backlog.title')}</span>
            <span className="text-ink-3">{b.items.length}</span>
          </button>
        )
      })()}
      <div className="px-4 py-2 border-b border-edge shrink-0 space-y-1.5">
        <select className={selectClass} value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label={t('changes.type')}>
          <option value="">{t('changes.allTypes')}</option>
          {typeOptions.map(([ref, label]) => <option key={ref} value={ref}>{label}</option>)}
        </select>
        <select className={selectClass} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label={t('changes.status')}>
          <option value="">{t('changes.allStatuses')}</option>
          {statusOptions.map(([name, label]) => <option key={name} value={name}>{label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />
          {t('changes.mine')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
          <input type="checkbox" checked={hideTerminal} onChange={e => setHideTerminal(e.target.checked)} data-testid="changes-hide-terminal" />
          {t('changes.hideTerminal')}
        </label>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {visible.length === 0 && (
          <p className="px-4 py-2 text-xs text-ink-3">{changes.length === 0 ? t('changes.empty') : t('changes.emptyFiltered')}</p>
        )}
        {(
          <div>
            {visible.map(c => {
              const active = c.id === activeId && c.repoPath === activeRepo
              const type = typeOf(c)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => open(c)}
                  data-testid={`change-row-${c.id}`}
                  className={`w-full text-left px-4 py-1.5 text-xs flex items-center gap-2 transition-colors ${active ? 'bg-hover text-prim' : 'text-ink-2 hover:bg-hover'}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: type?.color || 'var(--color-ink-3, #94a3b8)' }} title={type?.label || c.objectTypeRef} />
                  <span className="font-mono shrink-0 whitespace-nowrap">{c.id}</span>
                  <span className="truncate flex-1">{c.title}</span>
                  <span className="text-ink-3 shrink-0">{statusLabel(c)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
