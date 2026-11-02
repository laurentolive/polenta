import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Inbox, Lock, Package, Plus } from 'lucide-react'
import type { VersionComponentNode, VersionSummary } from '@polenta/types'
import { api } from '../../../api'
import { decodeProjectId } from '../../../lib/projectId'
import { NodeContextMenu, type NodeContextMenuEntry } from '../../../tiptap/NodeContextMenu'
import { useModalHotkeys } from '../../../hooks/useModalHotkeys'
import { ComponentTypeCombobox } from '../../system/ComponentTypeCombobox'
import type { ComponentTypeOption } from '../../../contexts/SystemViewContext'
import { NewVersionDialog } from '../../versions/NewVersionDialog'
import { STATE_BADGE, isProductVersionsPath, useInvalidateVersions, useVersionTree, versionErrorText } from '../../versions/useVersions'

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
  const invalidate = useInvalidateVersions()
  const workspaceDir = decodeProjectId(projectId) || undefined
  // Version copiée : se colle dans son propre composant (ses changements sont des éléments de ce repo).
  const [copied, setCopied] = useState<{ repoPath: string; id: string; title: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; version: VersionSummary | null } | null>(null)
  const [deleting, setDeleting] = useState<VersionSummary | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const options: ComponentTypeOption[] = flat.map(f => ({ repoName: f.node.repoPath, nodeId: '', typeId: '', label: f.label }))
  const openBacklog = (repoPath: string) => void navigate({ to: '/versions/backlog', search: { projectId, repoPath } })
  const openVersion = (repoPath: string, versionId: string) =>
    void navigate({ to: '/version/$versionId', params: { versionId }, search: { projectId, repoPath } })
  const select = (repoPath: string) => {
    setChosen(repoPath)
    writeLastComponent(projectId, repoPath)
    // Sans type version, pas de backlog à montrer : le panneau porte le message explicatif.
    if (flat.find(f => f.node.repoPath === repoPath)?.node.versionType) openBacklog(repoPath)
    else void navigate({ to: '/versions', search: { projectId } })
  }
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const versions = (current?.versions ?? []).filter(v => showAbandoned || v.state !== 'abandoned')
  const deps = current?.children ?? []
  const paste = async () => {
    if (!copied || !current) return
    setActionError(null)
    try {
      const created = await api.versions.copy(current.repoPath, copied.id, workspaceDir)
      await invalidate()
      openVersion(current.repoPath, created.id)
    } catch (err) {
      setActionError(versionErrorText(t, err))
    }
  }
  const confirmDelete = async () => {
    if (!deleting || !current) return
    const { id } = deleting
    setDeleting(null)
    setActionError(null)
    try {
      await api.versions.delete(current.repoPath, id, workspaceDir)
      if (copied?.id === id && copied.repoPath === current.repoPath) setCopied(null)
      await invalidate()
      if (pathname === `/version/${id}`) openBacklog(current.repoPath)
    } catch (err) {
      setActionError(versionErrorText(t, err))
    }
  }
  const canPaste = !!copied && copied.repoPath === current?.repoPath && !current?.readonly
  const pasteItem: NodeContextMenuEntry = {
    id: 'paste', label: copied ? t('versions.menu.pasteHint', { version: copied.title }) : t('versions.menu.paste'),
    disabled: !canPaste, onSelect: () => void paste(),
  }
  const menuItems = (v: VersionSummary | null): NodeContextMenuEntry[] => {
    if (!v || !current) return [pasteItem]
    const frozen = !!v.freeze || v.state === 'released'
    return [
      { id: 'copy', label: t('versions.menu.copy'), onSelect: () => setCopied({ repoPath: current.repoPath, id: v.id, title: v.title }) },
      pasteItem,
      'separator',
      {
        id: 'delete', label: frozen ? t('versions.menu.deleteReleased') : t('versions.menu.delete'), danger: true,
        disabled: frozen || current.readonly, onSelect: () => setDeleting(v),
      },
    ]
  }
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
            title={t('versions.new.title')}
            className="btn-icon text-prim shrink-0"
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

      <div
        className="flex-1 overflow-y-auto py-0.5"
        onContextMenu={e => { if (current?.versionType) { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, version: null }) } }}
      >
        {actionError && <p className="px-4 py-2 text-xs text-status-danger" role="alert">{actionError}</p>}
        {isLoading && <p className="px-4 py-2 text-xs text-ink-3 italic">{t('common.loading')}</p>}
        {error && <p className="px-4 py-2 text-xs text-status-danger">{String(error)}</p>}
        {current && !current.versionType && (
          <div className="px-4 py-3 flex flex-col gap-2 text-xs text-ink-2" data-testid="version-no-type">
            <p>{t('versions.noTypeHelp')}</p>
            {current.readonly && <p className="text-status-warning">{t('versions.noTypeReadonly')}</p>}
            <button type="button" onClick={() => void navigate({ to: '/schema', search: { repoPath: '', projectId } })} className="btn-secondary-sm self-start">
              {t('versions.openSchema')}
            </button>
          </div>
        )}
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
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, version: v }) }}
                onOpenComponent={(dep, id) => { setChosen(dep.repoPath); writeLastComponent(projectId, dep.repoPath); openVersion(dep.repoPath, id) }}
              />
            ))}
          </>
        )}
      </div>

      {menu && <NodeContextMenu x={menu.x} y={menu.y} items={menuItems(menu.version)} onClose={() => setMenu(null)} />}
      {deleting && <DeleteVersionDialog version={deleting} onConfirm={() => void confirmDelete()} onClose={() => setDeleting(null)} />}
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
function VersionRow({ version, deps, open, active, rowClass, onToggle, onOpen, onContextMenu, onOpenComponent }: {
  version: VersionSummary
  deps: VersionComponentNode[]
  open: boolean
  active: boolean
  rowClass: (active: boolean) => string
  onToggle: () => void
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onOpenComponent: (dep: VersionComponentNode, versionId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <div className={rowClass(active)} onContextMenu={onContextMenu}>
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
        ) : <span className="shrink-0 text-ink-3 italic">{dep.versionType ? (versionId ?? t('versions.none')) : t('versions.noType')}</span>}
      </div>
      {dep.children.length > 0 && (
        <ul>
          {dep.children.map(c => (
            <ComponentVersionNode key={c.repoPath} dep={c} versionId={sel?.components?.[c.name]} depth={depth + 1} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  )
}

function DeleteVersionDialog({ version, onConfirm, onClose }: { version: VersionSummary; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  useModalHotkeys(onClose, onConfirm)
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div role="dialog" aria-label={t('versions.delete.title')} className="bg-surface border border-edge rounded-lg shadow-xl w-[26rem] max-w-[95vw]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{t('versions.delete.title')}</h2>
        </div>
        <p className="p-4 text-xs text-ink-2">{t('versions.delete.body', { version: `${version.title} (${version.id})` })}</p>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-edge">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={onConfirm} className="btn-primary-sm" data-testid="version-delete-confirm">{t('versions.delete.confirm')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
