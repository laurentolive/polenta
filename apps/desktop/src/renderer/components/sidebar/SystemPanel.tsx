/**
 * SystemPanel — sidebar panel for the System view.
 *
 * Per SPEC-SYSTEM-VIEW, this panel is the primary navigation container:
 *   - Combobox "Composant / Élément" — filterable, one entry per (SystemNode, ObjectTypeDefinition)
 *   - FilterBar                       — filter options (case / whole-word / regex)
 *   - ElementTree                     — full tree, fills remaining space
 *
 * State is shared with SystemView (main area) via SystemViewContext.
 */

import { useState, useCallback, useMemo } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { useSystemView } from '../../contexts/SystemViewContext'
import { ElementTree } from '../system/ElementTree'
import { ComponentTypeCombobox } from '../system/ComponentTypeCombobox'
import { useSystemObjects } from '../../hooks/useSystemObjects'
import { normalizeObject } from '../../lib/normalizeObject'
import { FilterOptionsToggle } from '../FilterOptionsToggle'
import { buildFilterRegex } from '../../lib/textFilter'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { api } from '../../api'
import type { TypeTreeNode } from '@polenta/types'
import type { UpdateTestCaseDto } from '@polenta/zod-schemas'

interface Props {
  currentProjectId: string
  projectId: string
}

// ── FilterBar ─────────────────────────────────────────────────────────────────

function FilterBar() {
  const { t } = useTranslation()
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
        placeholder={t('common.filterPlaceholder')}
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
  planned:     'bg-status-neutral-bg text-status-neutral',
  in_progress: 'bg-status-info-bg text-status-info',
  completed:   'bg-status-success-bg text-status-success',
  abandoned:   'bg-status-danger-bg text-status-danger',
}

const STATUS_LABEL_KEY: Record<string, string> = {
  planned:     'sidebar.system.statusPlanned',
  in_progress: 'sidebar.system.statusInProgress',
  completed:   'sidebar.system.statusCompleted',
  abandoned:   'sidebar.system.statusAbandoned',
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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { searchStr } = useRouterState({ select: s => ({ searchStr: s.location.searchStr }) })
  const projectId = new URLSearchParams(searchStr ?? '').get('projectId') ?? ''
  const repo = new URLSearchParams(searchStr ?? '').get('repo') ?? undefined
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const { filter, filterOptions, category } = useSystemView()

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

  useModalHotkeys(
    () => setPendingDeleteId(null),
    () => pendingDeleteId && deleteMutation.mutate(pendingDeleteId),
    !pendingDeleteId || deleteMutation.isPending,
  )

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
    return <div className="p-3 text-xs text-ink-3">{t('common.loading')}</div>
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
                search: { projectId, repo, component, type: level, level: undefined, tab: undefined, category },
              })
            }
            className="text-xs text-ink-3 hover:text-ink hover:underline cursor-pointer"
          >
            {filterRe
              ? t('sidebar.system.campaignCountFiltered', { visible: visibleCampaigns.length, total: campaigns.length, count: campaigns.length })
              : t('sidebar.system.campaignCount', { count: campaigns.length })}
          </button>
          <button
            type="button"
            onClick={newCampaign}
            className="text-xs text-ink-3 hover:text-ink px-1"
            title={t('sidebar.system.newCampaign')}
          >
            +
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
              <p className="text-xs text-ink-3">{t('sidebar.system.noCampaign')}</p>
              <button type="button" onClick={newCampaign} className="text-xs text-prim hover:underline">
                {t('sidebar.system.createFirstCampaign')}
              </button>
            </div>
          ) : visibleCampaigns.length === 0 ? (
            <div className="flex items-center justify-center h-full py-8">
              <p className="text-xs text-ink-3">{t('common.noResults')}</p>
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
                      {STATUS_LABEL_KEY[camp.status] ? t(STATUS_LABEL_KEY[camp.status]) : camp.status}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setPendingDeleteId(camp.id) }}
                    title={t('common.delete')}
                    className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-status-danger transition-opacity shrink-0"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40">
          <div className="bg-surface rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-base font-semibold mb-2">{t('sidebar.system.deleteCampaignTitle')}</h2>
            <p className="text-sm text-ink-2 mb-5">
              <Trans
                i18nKey="sidebar.system.deleteCampaignBody"
                values={{ title: pendingCampaign?.title ?? pendingDeleteId }}
                components={{ b: <strong /> }}
              />
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setPendingDeleteId(null)}
                disabled={deleteMutation.isPending}
                className="btn-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(pendingDeleteId)}
                disabled={deleteMutation.isPending}
                className="btn-danger"
              >
                {deleteMutation.isPending ? t('sidebar.system.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Reuses the activity-bar labels (Exigences/Tests/Campagnes) for the panel header — one source
// of truth for the tab's name (T145 split of the former single "Système" panel).
const CATEGORY_TITLE_KEY: Record<string, string> = {
  requirement: 'layout.activityBar.requirements',
  test: 'layout.activityBar.tests',
  campaign: 'layout.activityBar.campaigns',
}

// ── SystemPanel ───────────────────────────────────────────────────────────────

export function SystemPanel({ currentProjectId: _currentProjectId, projectId: _projectId }: Props) {
  const { t } = useTranslation()
  const {
    nodes,
    schemaLoading,
    category,
    componentTypeOptions,
    selectedComponentTypeIndex,
    handleTargetChange,
    isRepoReadonly,
    effectiveNodeId,
    objectTypes,
    effectiveTypeId,
    root,
    setRoot,
    generateId,
    effectiveType,
    readOnly,
    filter,
    filterOptions,
    editingNodeId,
    setEditingNodeId,
    createItemObject,
    repoPath,
    requestGoto,
    clearGoto,
  } = useSystemView()

  const qc = useQueryClient()

  // Local selection state for the tree (doesn't affect the doc view per spec)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // T166 — périmètre de recherche de l'arbre aligné sur les Vues Word/Excel : le filtre global
  // doit aussi fouiller le titre et toutes les valeurs de champs, pas seulement le nom de nœud
  // et l'`objectId`. Même query (donc même cache) que `SystemView` — aucun fetch en double.
  const { data: rawObjects = [] } = useSystemObjects(
    repoPath,
    effectiveType?.category,
    effectiveNodeId,
    effectiveTypeId,
  )
  const searchTextByObjectId = useMemo(() => {
    const map = new Map<string, string>()
    for (const obj of rawObjects) {
      if (!obj.id) continue
      map.set(obj.id, Object.values(normalizeObject(obj)).join(' '))
    }
    return map
  }, [rawObjects])

  const handleDoubleClick = useCallback((nodeId: string) => {
    // Double-click on an item → open Edit view in the main area
    setEditingNodeId(nodeId)
  }, [setEditingNodeId])

  // T164 — clic simple / dépôt d'un drag & drop dans l'arbre → goto dans la vue document
  // (null = clic dans le vide → efface la cible). No-op en Vue Édition (CU2) : on supprime
  // la requête à la source pour qu'aucune cible périmée ne subsiste au retour en Word/Excel.
  const handleGoto = useCallback((nodeId: string | null) => {
    if (editingNodeId !== null) return
    if (nodeId) requestGoto(nodeId)
    else clearGoto()
  }, [editingNodeId, requestGoto, clearGoto])

  // T161 — le renommage inline d'un élément dans l'arbre latéral ne mettait à jour que le
  // fichier d'arbre ; le titre de l'objet correspondant restait figé (« Sans titre »).
  // Miroir de `handleRenameNode` de SystemView (branché lui sur la Vue Tableau / le champ
  // Nom de la Vue Édition).
  const handleItemRenamed = useCallback((objectId: string, name: string) => {
    if (!repoPath) return
    const cat = effectiveType?.category
    const done = () => {
      qc.invalidateQueries({ queryKey: ['requirements-all', repoPath] })
      qc.invalidateQueries({ queryKey: ['tests-all', repoPath] })
      if (cat) qc.invalidateQueries({ queryKey: ['object', repoPath, cat, objectId] })
    }
    if (cat === 'requirement') {
      api.requirements.update(repoPath, objectId, { title: name }).then(done)
        .catch(err => console.error('[SystemPanel] T161 — sync titre exigence:', err))
    } else if (cat === 'test') {
      api.tests.update(repoPath, objectId, { title: name } as UpdateTestCaseDto).then(done)
        .catch(err => console.error('[SystemPanel] T161 — sync titre test:', err))
    }
  }, [repoPath, effectiveType?.category, qc])

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
          {t('common.loading')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header (T92 — cohérent avec les autres panneaux latéraux) ── */}
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <p className="section-label">{t(CATEGORY_TITLE_KEY[category] ?? 'sidebar.system.title')}</p>
      </div>

      {/* ── Combobox Composant / Élément (T129 — fusion filtrable des deux comboboxes T120/T113,
          un entrée par (SystemNode, ObjectTypeDefinition)) ── */}
      <div className="px-3 py-2 border-b border-edge shrink-0">
        <ComponentTypeCombobox
          options={componentTypeOptions}
          selectedIndex={selectedComponentTypeIndex}
          onSelect={opt => handleTargetChange(opt.repoName, opt.nodeId, opt.typeId)}
        />
      </div>

      {isRepoReadonly && (
        <div className="px-3 py-1.5 border-b border-edge bg-status-warning-bg text-status-warning text-xs shrink-0">
          {t('sidebar.system.readonlyBaseline')}
        </div>
      )}

      {/* ── FilterBar ── */}
      <FilterBar />

      {/* ── ElementTree ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-ink-3 text-xs px-3 text-center">
            {t('sidebar.system.noComponentConfiguredBody')}
            <br />
            {t('sidebar.system.goToDataModel')}
          </div>
        ) : objectTypes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-ink-3 text-xs px-3 text-center">
            {t('sidebar.system.noElementConfiguredForComponent')}
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
            searchTextByObjectId={searchTextByObjectId}
            readOnly={readOnly}
            onItemNodeAdded={createItemObject}
            onItemRenamed={handleItemRenamed}
            onGoto={handleGoto}
          />
        )}
      </div>
    </div>
  )
}
