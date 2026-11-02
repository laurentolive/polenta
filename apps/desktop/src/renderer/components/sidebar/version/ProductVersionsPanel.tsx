import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Inbox, Lock, Package, Plus } from 'lucide-react'
import type { VersionComponentNode, VersionSummary } from '@polenta/types'
import { decodeProjectId } from '../../../lib/projectId'
import { ComponentTypeCombobox } from '../../system/ComponentTypeCombobox'
import type { ComponentTypeOption } from '../../../contexts/SystemViewContext'
import { NewVersionDialog } from '../../versions/NewVersionDialog'
import { STATE_BADGE, isProductVersionsPath, useVersionTree } from '../../versions/useVersions'

interface FlatNode { node: VersionComponentNode; label: string }

const LAST_COMPONENT_KEY = 'polenta:versionsComponent:'

function readLastComponent(projectId: string): string | null {
  try { return localStorage.getItem(LAST_COMPONENT_KEY + projectId) } catch { return null }
}
function writeLastComponent(projectId: string, repoPath: string): void {
  try { localStorage.setItem(LAST_COMPONENT_KEY + projectId, repoPath) } catch { /* stockage indisponible */ }
}

/** Arbre des repos à plat, libellé = chemin (« Produit › Moteur »), ordre de l'arbre. */
function flatten(nodes: VersionComponentNode[], prefix = ''): FlatNode[] {
  return nodes.flatMap(n => {
    const label = prefix ? `${prefix} › ${n.label}` : n.label
    return [{ node: n, label }, ...flatten(n.children, label)]
  })
}

/**
 * GH201 §6 — sous-panneau « Produit » du panneau Version : un composant (repo) choisi dans une liste
 * déroulante, comme dans les vues Exigences / Tests / Campagnes ; pour lui, le backlog des
 * changements (indépendant des versions), puis ses versions, du plus récent au plus ancien, chacune
 * dépliable sur les versions des composants qu'elle contient.
 */
export function ProductVersionsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const search = useRouterState({ select: s => s.location.search as Record<string, unknown> })
  const { data: tree, isLoading, error } = useVersionTree(projectId)
  const flat = useMemo(() => flatten(tree ?? []), [tree])

  // Composant affiché : celui de la page ouverte (version, backlog), sinon le dernier choisi.
  const urlRepo = isProductVersionsPath(pathname) && typeof search['repoPath'] === 'string' ? search['repoPath'] as string : ''
  const [chosen, setChosen] = useState<string | null>(() => readLastComponent(projectId))
  useEffect(() => { if (urlRepo) setChosen(urlRepo) }, [urlRepo])
  const selectedIndex = Math.max(0, flat.findIndex(f => f.node.repoPath === (urlRepo || chosen)))
  const current = flat[selectedIndex]?.node

  const [showAbandoned, setShowAbandoned] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  const options: ComponentTypeOption[] = flat.map(f => ({ repoName: f.node.repoPath, nodeId: '', typeId: '', label: f.label }))
  const openBacklog = (repoPath: string) => void navigate({ to: '/versions/backlog', search: { projectId, repoPath } })
  const openVersion = (repoPath: string, versionId: string) =>
    void navigate({ to: '/version/$versionId', params: { versionId }, search: { projectId, repoPath } })
  const select = (repoPath: string) => {
    setChosen(repoPath)
    writeLastComponent(projectId, repoPath)
    openBacklog(repoPath)
  }
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const inProgress = current?.versions.find(v => v.state === 'in_progress')
  const versions = (current?.versions ?? []).filter(v => showAbandoned || v.state !== 'abandoned')
  const deps = (current?.children ?? []).filter(c => c.versionType)
  const rowClass = (active: boolean) =>
    `w-full flex items-center gap-2 pr-3 py-1 text-xs text-left ${active ? 'bg-hover text-prim font-medium' : 'text-ink-2 hover:bg-hover'}`
  const onCurrentRepo = urlRepo === current?.repoPath

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="product-versions-panel">
      <div className="px-3 py-2 border-b border-edge shrink-0 flex items-center gap-2">
        <ComponentTypeCombobox options={options} selectedIndex={flat.length ? selectedIndex : -1} onSelect={opt => select(opt.repoName)} />
        {current?.versionType && !current.readonly && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!!inProgress}
            title={inProgress ? t('versions.new.inProgressExists', { id: inProgress.id }) : t('versions.new.title')}
            className="btn-icon text-prim disabled:opacity-40 shrink-0"
            data-testid="new-version"
          >
            <Plus size={14} />
          </button>
        )}
        {current?.readonly && <span title={t('versions.readonly')}><Lock size={12} className="text-status-warning shrink-0" /></span>}
      </div>
      <label className="flex items-center gap-2 px-4 py-1.5 text-xs text-ink-3 border-b border-edge-subtle shrink-0">
        <input type="checkbox" checked={showAbandoned} onChange={e => setShowAbandoned(e.target.checked)} />
        {t('versions.showAbandoned')}
      </label>

      <div className="flex-1 overflow-y-auto py-0.5">
        {isLoading && <p className="px-4 py-2 text-xs text-ink-3 italic">{t('common.loading')}</p>}
        {error && <p className="px-4 py-2 text-xs text-status-danger">{String(error)}</p>}
        {current && !current.versionType && <p className="px-4 py-2 text-xs text-ink-3 italic">{t('versions.noType')}</p>}
        {current?.versionType && (
          <>
            <button
              type="button"
              onClick={() => openBacklog(current.repoPath)}
              className={`${rowClass(pathname === '/versions/backlog' && onCurrentRepo)} pl-4 border-b border-edge-subtle`}
              data-testid="version-backlog"
            >
              <Inbox size={13} className="shrink-0" />
              <span className="flex-1 truncate">{t('versions.backlog.changeBacklog')}</span>
              <span className="text-ink-3">{current.backlogCount}</span>
            </button>

            {versions.length === 0 && <p className="px-4 py-1 text-xs text-ink-3 italic">{t('versions.noVersion')}</p>}
            {versions.map(v => (
              <VersionRow
                key={v.id}
                version={v}
                deps={deps}
                open={expanded.has(v.id)}
                active={pathname === `/version/${v.id}` && onCurrentRepo}
                rowClass={rowClass}
                onToggle={() => toggle(v.id)}
                onOpen={() => openVersion(current.repoPath, v.id)}
                onOpenComponent={(dep, id) => { setChosen(dep.repoPath); writeLastComponent(projectId, dep.repoPath); openVersion(dep.repoPath, id) }}
              />
            ))}
          </>
        )}
      </div>

      {creating && current && (
        <NewVersionDialog
          node={current}
          workspaceDir={decodeProjectId(projectId)}
          onClose={() => setCreating(false)}
          onCreated={v => { setCreating(false); openVersion(current.repoPath, v.id) }}
        />
      )}
    </div>
  )
}

/** Une version du composant ; dépliée : la version retenue de chaque composant qu'elle contient. */
function VersionRow({ version, deps, open, active, rowClass, onToggle, onOpen, onOpenComponent }: {
  version: VersionSummary
  deps: VersionComponentNode[]
  open: boolean
  active: boolean
  rowClass: (active: boolean) => string
  onToggle: () => void
  onOpen: () => void
  onOpenComponent: (dep: VersionComponentNode, versionId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <div className={rowClass(active)}>
        <button
          type="button"
          onClick={onToggle}
          disabled={deps.length === 0}
          aria-label={open ? t('versions.collapse') : t('versions.expand')}
          className="pl-2 text-ink-3 hover:text-ink disabled:invisible"
          data-testid={`version-toggle-${version.id}`}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button type="button" onClick={onOpen} className="flex-1 flex items-center gap-2 min-w-0 text-left" data-testid={`version-row-${version.id}`}>
          <span className="flex-1 truncate">{version.title}</span>
          <span className="text-ink-3 text-[10px] font-mono">{version.id}</span>
          <span className={`px-1.5 rounded text-[10px] ${STATE_BADGE[version.state]}`}>{t(`versions.state.${version.state}`)}</span>
        </button>
      </div>
      {open && (
        <ul className="pb-1" data-testid={`version-components-${version.id}`}>
          {deps.map(dep => (
            <ComponentVersionNode key={dep.repoPath} dep={dep} versionId={version.components?.[dep.name]} depth={0} onOpen={onOpenComponent} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Structure des composants d'une version : cube, label du composant, sa version à droite ; sous lui,
 * les composants que contient cette version (récursif, comme l'arbre du workspace).
 */
function ComponentVersionNode({ dep, versionId, depth, onOpen }: {
  dep: VersionComponentNode
  versionId: string | undefined
  depth: number
  onOpen: (dep: VersionComponentNode, versionId: string) => void
}) {
  const { t } = useTranslation()
  const sel = versionId ? dep.versions.find(v => v.id === versionId) : undefined
  const children = dep.children.filter(c => c.versionType)
  return (
    <li>
      <div className="flex items-center gap-1.5 pr-3 py-0.5 text-xs" style={{ paddingLeft: `${36 + depth * 14}px` }}>
        <Package size={12} className="shrink-0 text-chart-4" />
        <span className="flex-1 truncate text-ink-2" title={dep.label}>{dep.label}</span>
        {sel ? (
          <button type="button" onClick={() => onOpen(dep, sel.id)} className="flex items-center gap-1.5 shrink-0 text-prim hover:underline" title={sel.id}>
            <span>{sel.title}</span>
            <span className={`px-1.5 rounded text-[10px] ${STATE_BADGE[sel.state]}`}>{t(`versions.state.${sel.state}`)}</span>
          </button>
        ) : <span className="shrink-0 text-ink-3">{versionId ?? t('versions.none')}</span>}
      </div>
      {sel && children.length > 0 && (
        <ul>
          {children.map(c => (
            <ComponentVersionNode key={c.repoPath} dep={c} versionId={sel.components?.[c.name]} depth={depth + 1} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  )
}
