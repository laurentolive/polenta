/**
 * SystemPanel — sidebar panel for the System view.
 *
 * Per SPEC-SYSTEM-VIEW, this panel is the primary navigation container:
 *   - Combobox "Composant" — lists SystemNodes
 *   - Combobox "Élément"   — lists ObjectTypeDefinitions for the selected node
 *   - FilterBar             — filter options (case / whole-word / regex)
 *   - ElementTree           — full tree, fills remaining space
 *
 * State is shared with SystemView (main area) via SystemViewContext.
 */

import { useState, useCallback, type ReactNode } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useSystemView } from '../../contexts/SystemViewContext'
import type { ComponentOption } from '../../contexts/SystemViewContext'
import { ElementTree } from '../system/ElementTree'
import { FilterOptionsToggle } from '../FilterOptionsToggle'
import { buildFilterRegex } from '../../lib/textFilter'
import { api } from '../../api'
import type { TypeTreeNode } from '@polenta/types'

/** Renders the merged "Composant" combobox's options (T120): entries sharing the same
 *  `groupLabel` (a repo with several local SystemNode, T113) render inside one <optgroup> —
 *  entries without one render as plain top-level <option>s. `componentOptions` already groups
 *  a given repo's entries contiguously (built via `flatNodes.flatMap`), so a single sequential
 *  pass suffices — no sorting needed. Each `<option>`'s value is its array index rather than a
 *  serialized "repoName::nodeId" string: a repo mount name or local SystemNode name has no
 *  character restriction (cf. AddDependencyModal), so a delimited-string round-trip would be
 *  fragile if either ever contained the separator — indexing sidesteps that entirely (found in
 *  review). */
function renderComponentOptions(options: ComponentOption[]): ReactNode[] {
  const elements: ReactNode[] = []
  let i = 0
  while (i < options.length) {
    const opt = options[i]
    if (!opt.groupLabel) {
      elements.push(
        <option key={i} value={i}>
          {opt.label}
        </option>,
      )
      i++
      continue
    }
    let end = i + 1
    while (end < options.length && options[end].groupLabel === opt.groupLabel) end++
    elements.push(
      <optgroup key={opt.groupLabel} label={opt.groupLabel}>
        {options.slice(i, end).map((o, j) => (
          <option key={i + j} value={i + j}>
            {o.label}
          </option>
        ))}
      </optgroup>,
    )
    i = end
  }
  return elements
}

interface Props {
  currentProjectId: string
  projectId: string
}

// ── FilterBar ─────────────────────────────────────────────────────────────────

function FilterBar() {
  const {
    filter,
    setFilter,
    filterOptions,
    setFilterOptions,
  } = useSystemView()

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-edge bg-surface shrink-0">
      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setFilter('')
        }}
        placeholder="Filtrer…"
        className="flex-1 text-xs bg-transparent text-ink border-0 outline-none placeholder:text-ink-3"
      />
      <FilterOptionsToggle options={filterOptions} onChange={setFilterOptions} />
      {filter && (
        <button
          type="button"
          onClick={() => setFilter('')}
          className="text-ink-3 hover:text-ink text-xs"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── CampaignNavList ───────────────────────────────────────────────────────────

const STATUS_CLASS: Record<string, string> = {
  planned:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-400',
  completed:   'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400',
  abandoned:   'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400',
}

const STATUS_LABEL: Record<string, string> = {
  planned:     'Planifiée',
  in_progress: 'En cours',
  completed:   'Terminée',
  abandoned:   'Abandonnée',
}

function CampaignNavList({
  repoPath,
  component,
  level,
}: {
  repoPath: string
  component?: string
  level?: string
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { searchStr } = useRouterState({ select: s => ({ searchStr: s.location.searchStr }) })
  const projectId = new URLSearchParams(searchStr ?? '').get('projectId') ?? ''
  const repo = new URLSearchParams(searchStr ?? '').get('repo') ?? undefined
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const { filter, filterOptions } = useSystemView()

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', repoPath, component, level],
    queryFn: () => api.campaigns.list(repoPath, component, level),
    enabled: !!repoPath,
  })

  const filterRe = buildFilterRegex(filter, filterOptions)
  const visibleCampaigns = filterRe
    ? campaigns.filter(c =>
        filterRe.test(c.id) ||
        filterRe.test(c.title) ||
        filterRe.test(c.status) ||
        Object.values(c.fields ?? {}).some(v => typeof v === 'string' && filterRe.test(v)),
      )
    : campaigns

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.campaigns.delete(repoPath, id),
    onSuccess: () => {
      setPendingDeleteId(null)
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
    },
  })

  function openCampaign(id: string) {
    navigate({
      to: '/campaign/$campaignId',
      params: { campaignId: id },
      search: { repoPath, projectId, component, level },
    })
  }

  function newCampaign() {
    navigate({ to: '/campaign/new', search: { repoPath, projectId, component, level, title: undefined, testCaseIds: undefined } })
  }

  if (isLoading) {
    return <div className="p-3 text-xs text-ink-3">Chargement…</div>
  }

  const pendingCampaign = campaigns.find(c => c.id === pendingDeleteId)

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-edge shrink-0">
          <button
            type="button"
            onClick={() =>
              navigate({
                to: '/components',
                search: { projectId, repo, component, type: level, level: undefined, tab: undefined },
              })
            }
            className="text-xs text-ink-3 hover:text-ink hover:underline cursor-pointer"
          >
            {filterRe
              ? `${visibleCampaigns.length}/${campaigns.length} campagne${campaigns.length !== 1 ? 's' : ''}`
              : `${campaigns.length} campagne${campaigns.length !== 1 ? 's' : ''}`}
          </button>
          <button
            type="button"
            onClick={newCampaign}
            className="text-xs text-ink-3 hover:text-ink px-1"
            title="Nouvelle campagne"
          >
            +
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
              <p className="text-xs text-ink-3">Aucune campagne</p>
              <button type="button" onClick={newCampaign} className="text-xs text-blue-600 hover:underline">
                Créer la première
              </button>
            </div>
          ) : visibleCampaigns.length === 0 ? (
            <div className="flex items-center justify-center h-full py-8">
              <p className="text-xs text-ink-3">Aucun résultat</p>
            </div>
          ) : (
            <div className="py-1">
              {visibleCampaigns.map(camp => (
                <div
                  key={camp.id}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-hover transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => openCampaign(camp.id)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <span className="text-xs text-ink truncate flex-1">{camp.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${STATUS_CLASS[camp.status] ?? STATUS_CLASS['planned']}`}>
                      {STATUS_LABEL[camp.status] ?? camp.status}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setPendingDeleteId(camp.id) }}
                    title="Supprimer"
                    className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-red-500 transition-opacity shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {pendingDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-base font-semibold mb-2">Supprimer la campagne ?</h2>
            <p className="text-sm text-ink-2 mb-5">
              La campagne <strong>{pendingCampaign?.title ?? pendingDeleteId}</strong> sera supprimée définitivement.
              Cette action est irréversible.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setPendingDeleteId(null)}
                disabled={deleteMutation.isPending}
                className="btn-secondary text-sm"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(pendingDeleteId)}
                disabled={deleteMutation.isPending}
                className="bg-red-600 hover:bg-red-700 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── SystemPanel ───────────────────────────────────────────────────────────────

export function SystemPanel({ currentProjectId: _currentProjectId, projectId: _projectId }: Props) {
  const {
    nodes,
    schemaLoading,
    componentOptions,
    selectedComponentIndex,
    handleComponentChange,
    isRepoReadonly,
    effectiveNodeId,
    objectTypes,
    effectiveTypeId,
    handleTypeChange,
    root,
    setRoot,
    generateId,
    effectiveType,
    readOnly,
    filter,
    filterOptions,
    setEditingNodeId,
    createItemObject,
    repoPath,
  } = useSystemView()

  const qc = useQueryClient()

  // Local selection state for the tree (doesn't affect the doc view per spec)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const handleDoubleClick = useCallback((nodeId: string) => {
    // Double-click on an item → open Edit view in the main area
    setEditingNodeId(nodeId)
  }, [setEditingNodeId])

  const handleRootChange = useCallback((newRoot: TypeTreeNode[]) => {
    // TODO: détecter les items supprimés et archiver leurs objets backend
    // const removedObjectIds = collectObjectIds(root).filter(id => !collectObjectIds(newRoot).includes(id))
    setRoot(newRoot)
    if (repoPath && effectiveNodeId && effectiveTypeId) {
      api.tree.save(repoPath, { nodeId: effectiveNodeId, typeId: effectiveTypeId, root: newRoot })
        .then(() => qc.invalidateQueries({ queryKey: ['tree', repoPath, effectiveNodeId, effectiveTypeId] }))
        .catch(err => console.error('[SystemPanel] Erreur save tree:', err))
    }
  }, [repoPath, effectiveNodeId, effectiveTypeId, setRoot, qc])

  if (schemaLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-ink-3 text-xs">
          Chargement…
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header (T92 — cohérent avec les autres panneaux latéraux) ── */}
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <p className="section-label">Système</p>
      </div>

      {/* ── Combobox Composant (repo du workspace T72 + sous-composant local T113, fusionnés
          en une seule liste plate — T120) ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0">
        <label className="text-xs text-ink-3 shrink-0">Composant</label>
        <select
          value={selectedComponentIndex}
          onChange={e => {
            const opt = componentOptions[Number(e.target.value)]
            if (opt) handleComponentChange(opt.repoName, opt.nodeId)
          }}
          className="input-field flex-1 text-xs py-1"
        >
          {componentOptions.length === 0 ? (
            <option value={-1}>Aucun composant configuré</option>
          ) : (
            renderComponentOptions(componentOptions)
          )}
        </select>
      </div>

      {isRepoReadonly && (
        <div className="px-3 py-1.5 border-b border-edge bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 text-xs shrink-0">
          Ce composant est figé sur une baseline — passez sur une branche pour l'éditer.
        </div>
      )}

      {/* ── Combobox Élément ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0">
        <label className="text-xs text-ink-3 shrink-0">Élément</label>
        <select
          value={effectiveTypeId}
          onChange={e => handleTypeChange(e.target.value)}
          disabled={objectTypes.length === 0}
          className="input-field flex-1 text-xs py-1"
        >
          {objectTypes.length === 0 ? (
            <option value="">Aucun élément configuré</option>
          ) : (
            objectTypes.map(t => (
              <option key={t.name} value={t.name}>
                {t.label || t.name}
              </option>
            ))
          )}
        </select>
      </div>

      {/* ── FilterBar ── */}
      <FilterBar />

      {/* ── ElementTree ── */}
      <div className="flex-1 overflow-hidden">
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-ink-3 text-xs px-3 text-center">
            Aucun composant configuré.
            <br />
            Allez dans Projet → Modèle de données.
          </div>
        ) : objectTypes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-ink-3 text-xs px-3 text-center">
            Aucun élément configuré pour ce composant.
          </div>
        ) : effectiveType?.category === 'campaign' ? (
          <CampaignNavList
            repoPath={repoPath}
            component={effectiveNodeId || undefined}
            level={effectiveTypeId || undefined}
          />
        ) : (
          <ElementTree
            root={root}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            onDoubleClick={handleDoubleClick}
            onRootChange={handleRootChange}
            generateId={generateId}
            typeName={effectiveType?.label ?? effectiveTypeId}
            filter={filter || undefined}
            filterOptions={filterOptions}
            readOnly={readOnly}
            onItemNodeAdded={createItemObject}
          />
        )}
      </div>
    </div>
  )
}
