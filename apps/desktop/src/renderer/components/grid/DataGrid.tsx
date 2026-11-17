import React, { createContext, memo, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { SavedView, SavedViewRef } from '@polenta/types'
import { useElementNav } from '../../contexts/ElementNavContext'
import { ExcelCellStoreContext, createExcelCellStore, refocusGrid, useCellGestures } from '../system/excelCellStore'
import { ExcelTextEditor } from '../system/ExcelTextEditor'
import { SavedViewsMenu } from '../system/SavedViewsMenu'
import { readExcelRowMaxLines, writeExcelRowMaxLines, ROW_MAX_LINES_ALL } from '../system/RowMaxHeightButton'
import { useViewScrollMemory } from '../system/viewScrollMemory'
import { ColumnFilterPopover } from './ColumnFilterPopover'
import { ColumnFreezeMenu } from './ColumnFreezeMenu'
import { ColumnPickerPanel } from './ColumnPickerPanel'
import type { ChecklistGroup } from './ColumnChecklist'
import { matchesColumnFilters } from './columnFilters'
import { autoWidth, maxAutoWidth } from './columnLayout'
import { buildTablePayload } from './exportTable'
import { GridHeaderCell } from './GridHeaderCell'
import { GridToolbar } from './GridToolbar'
import { CHECK_COL, EXPAND_COL, type GridColumn } from './gridTypes'
import type { GridKeyAction } from './gridKeyboard'
import { groupState, toggleGroup } from './rowSelection'
import { RowMaxLinesContext, useCellClamp } from './RowClamp'
import { useColumnFilters } from './useColumnFilters'
import { useColumnLayout } from './useColumnLayout'
import { useGridKeyboard } from './useGridKeyboard'
import { useGridPrefs, type GridPrefsSource } from './useGridPrefs'
import { useRowSelection, type RowSelectionMode } from './useRowSelection'

/** Échec d'une écriture en lot sur une ligne (les autres lignes sont écrites). */
export interface CellEditFailure {
  id: string
  message: string
}

export interface DataGridProps<R> {
  /** Préfixe des `data-testid` (`<gridId>-grid`, `<gridId>-row-<id>`, `<gridId>-<colonne>-<id>`…). */
  gridId: string
  /** Nom de feuille et de fichier de l'export. */
  title: string
  rows: readonly R[]
  getRowId(row: R): string
  /** Toutes les colonnes disponibles, mémoïsées par l'appelant. */
  columns: readonly GridColumn<R>[]
  prefs: GridPrefsSource
  /** Ancienne liste de colonnes enregistrée → liste courante (préférences d'avant la grille commune). */
  migrateColumns?: (stored: string[]) => string[]
  /** Vues enregistrées (GH203) : grilles rattachées à un type. */
  savedViews?: { typeKey: string; workspaceDir?: string }
  /** Filtres propres à l'écran, en tête de barre d'outils. */
  toolbarStart?: ReactNode
  /** Filtre de l'écran, combiné en ET avec les filtres de colonne (mémoïsé par l'appelant). */
  rowFilter?: (row: R) => boolean
  /** Sélection contrôlée ; absente : sélection de lignes locale. */
  selection?: {
    mode: RowSelectionMode
    selected: ReadonlySet<string>
    onChange(next: Set<string>): void
    /** Mode cases : ligne qui a une case (défaut : toutes) ; les autres ne se sélectionnent pas. */
    isSelectable?: (row: R) => boolean
  }
  /** Édition d'une cellule, propagée à la sélection quand la ligne éditée en fait partie (T149). */
  onCellEdit?: (rowIds: string[], key: string, value: string) => Promise<{ failed: CellEditFailure[] }>
  /** Entrée sur une cellule non éditable, double-clic de ligne. */
  onActivate?: (row: R) => void
  /** Ligne dépliée (chevron en tête) : contenu sous la ligne. */
  renderExpanded?: (row: R) => ReactNode
  /** Ligne qui a un contenu déplié (chevron affiché) ; défaut : toutes. */
  canExpand?: (row: R) => boolean
  rowClassName?: (row: R) => string | undefined
  /** Widget : ni barre d'outils, ni filtres, ni largeurs. */
  compact?: boolean
  noColumnPicker?: boolean
  noExport?: boolean
  noReorder?: boolean
  /** Repo de l'export (fichier enregistré) ; défaut : repo des préférences. */
  exportRepoPath?: string
  /** GH300 — mémoire du défilement (onglet + page) ; null en transition. */
  scrollMemoryKey?: string | null
  /** Grille dans une modale : panneau 👁 au-dessus d'elle. */
  layer?: 'page' | 'modal'
}

/** Cellule éditable : grille éditable, colonne avec éditeur, ligne acceptée par la colonne. */
function isEditableCell<R>(canEdit: boolean, col: GridColumn<R>, row: R): boolean {
  return canEdit && !!col.editor && (col.isEditable?.(row) ?? true)
}

/** Lignes rendues au premier affichage ; les suivantes juste après, en transition (comme la Vue Excel). */
const INITIAL_RENDERED_ROWS = 50
const EXPAND_COL_WIDTH = 24
const CHECK_COL_WIDTH = 28
const CELL_SELECTED_CLASS = 'ring-2 ring-inset ring-status-info'
const CELL_EDITABLE_CLASS = 'hover:ring-1 hover:ring-inset hover:ring-status-info'
const EMPTY: ReadonlySet<string> = new Set()

interface GridActions {
  edit(rowId: string, key: string, value: string): void
  /** Tab dans un éditeur : cellule suivante / précédente. */
  tab(rowId: string, key: string, shift: boolean): void
  rowClick(rowId: string, e: React.MouseEvent): void
  rowDoubleClick(rowId: string): void
  checkbox(rowId: string, shift: boolean): void
  toggleExpanded(rowId: string): void
}
const GridActionsContext = createContext<GridActions | null>(null)
const useGridActions = () => useContext(GridActionsContext)!

/**
 * GH389 — grille plate générique (spec §1, design §3) : filtre par colonne, largeurs, gel, ordre,
 * panneau 👁, hauteur des lignes, préférences et vues enregistrées, clavier, sélection et édition en
 * masse, export de ce qui est affiché, mémoire du défilement. Conventions DOM de la Vue Excel
 * (`data-node-id`, `data-selected`, `data-excel-grid`, `data-view-scroll`).
 */
export function DataGrid<R>(props: DataGridProps<R>) {
  const {
    gridId, title, rows, getRowId, columns, prefs: prefSource, migrateColumns, savedViews, toolbarStart, rowFilter, selection,
    onCellEdit, onActivate, renderExpanded, canExpand, rowClassName, compact, noColumnPicker, noExport, noReorder, exportRepoPath, scrollMemoryKey, layer,
  } = props
  const { t } = useTranslation()
  const nav = useElementNav()
  const prefs = useGridPrefs(prefSource)
  const view = 'local' in prefSource ? 'local' : prefSource.view
  const byKey = useMemo(() => new Map(columns.map(c => [c.key, c])), [columns])

  // ── Colonnes visibles ───────────────────────────────────────────────────────
  const normalize = useCallback((stored: string[]) => {
    const list = migrateColumns ? migrateColumns(stored) : stored
    const known = [...new Set(list)].filter(k => byKey.has(k))
    const locked = columns.filter(c => c.locked && !known.includes(c.key)).map(c => c.key)
    return [...locked, ...known]
  }, [migrateColumns, byKey, columns])
  const visibleKey = normalize(prefs.columns).join('\n')
  const visibleKeys = useMemo(() => (visibleKey ? visibleKey.split('\n') : []), [visibleKey])
  const shownCols = useMemo(() => visibleKeys.map(k => byKey.get(k)!), [visibleKeys, byKey])

  // ── Filtres ─────────────────────────────────────────────────────────────────
  const filters = useColumnFilters(visibleKeys, gridId)
  const getText = useCallback((row: R, key: string) => byKey.get(key)?.getText(row) ?? '', [byKey])
  const filteredRows = useMemo(
    () => rows.filter(r => (!rowFilter || rowFilter(r)) && matchesColumnFilters(r, filters.active, getText)),
    [rows, rowFilter, filters.active, getText],
  )
  const displayedIds = useMemo(() => filteredRows.map(getRowId), [filteredRows, getRowId])
  const isSelectable = selection?.isSelectable
  const selectableIds = useMemo(
    () => (isSelectable ? filteredRows.filter(isSelectable).map(getRowId) : displayedIds),
    [isSelectable, filteredRows, getRowId, displayedIds],
  )
  const rowById = useMemo(() => new Map(rows.map(r => [getRowId(r), r])), [rows, getRowId])

  // ── Largeurs, gel, ordre ────────────────────────────────────────────────────
  const hasExpand = !!renderExpanded
  const selectionMode: RowSelectionMode = selection?.mode ?? 'rows'
  const hasCheck = selectionMode === 'checkbox'
  const leadingKeys = useMemo(() => [...(hasExpand ? [EXPAND_COL] : []), ...(hasCheck ? [CHECK_COL] : [])], [hasExpand, hasCheck])
  const leadingWidth = (hasExpand ? EXPAND_COL_WIDTH : 0) + (hasCheck ? CHECK_COL_WIDTH : 0)
  const autoWidths = useMemo(() => {
    const max = maxAutoWidth()
    return Object.fromEntries(shownCols.map(c => [c.key, autoWidth(c.label, rows.map(r => c.getText(r)), max, c.filterable === false ? 0 : 3)]))
  }, [shownCols, rows])
  const layout = useColumnLayout({
    keys: visibleKeys,
    autoWidths,
    chosenWidths: prefs.widths,
    onWidthsChange: prefs.setWidths,
    freezeCount: prefs.freezeCount,
    leadingWidth,
    onReorder: noReorder || compact ? undefined : prefs.setColumns,
  })
  const [freezeMenu, setFreezeMenu] = useState<{ colIdx: number; x: number; y: number } | null>(null)
  const openFreezeMenu = useCallback((colIdx: number, x: number, y: number) => setFreezeMenu({ colIdx, x, y }), [])
  const [pickerOpen, setPickerOpen] = useState(false)

  // ── Sélection ───────────────────────────────────────────────────────────────
  const [localSelected, setLocalSelected] = useState<ReadonlySet<string>>(EMPTY)
  const selected = selection?.selected ?? localSelected
  const onSelectionChange = selection?.onChange ?? setLocalSelected
  const select = useRowSelection(selectionMode, selected, onSelectionChange, selectableIds)
  // Mode lignes : la sélection ne garde que des lignes affichées — une édition en lot ou une action
  // de la sélection n'atteint jamais une ligne masquée par un filtre. (Mode cases : la sélection
  // survit aux filtres, GH33.)
  useEffect(() => {
    if (selectionMode !== 'rows') return
    const shown = new Set(displayedIds)
    if ([...selected].every(id => shown.has(id))) return
    onSelectionChange(new Set([...selected].filter(id => shown.has(id))))
  }, [selectionMode, selected, displayedIds, onSelectionChange])

  const [localExpanded, setLocalExpanded] = useState<ReadonlySet<string>>(EMPTY)
  const toggleExpanded = useCallback((id: string) => setLocalExpanded(prev => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  }), [])

  // ── Rendu progressif, défilement ────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const [renderAll, setRenderAll] = useState(false)
  useEffect(() => {
    if (renderAll) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const raf = requestAnimationFrame(() => { timer = setTimeout(() => startTransition(() => setRenderAll(true)), 0) })
    return () => { cancelAnimationFrame(raf); if (timer) clearTimeout(timer) }
  }, [renderAll])
  const scrollMemory = useViewScrollMemory(containerRef, scrollMemoryKey ?? null, { ready: renderAll })
  const memoryIndex = scrollMemory.saved?.nodeId ? displayedIds.indexOf(scrollMemory.saved.nodeId) : -1
  const renderedRows = renderAll ? filteredRows : filteredRows.slice(0, Math.max(INITIAL_RENDERED_ROWS, memoryIndex + INITIAL_RENDERED_ROWS))

  // ── Cellule active, édition, clavier ────────────────────────────────────────
  const [cellStore] = useState(createExcelCellStore)
  useEffect(() => {
    const cell = cellStore.getSelected()
    if (cell && !leadingKeys.includes(cell.col) && !visibleKeys.includes(cell.col)) cellStore.select(null)
  }, [cellStore, visibleKeys, leadingKeys])
  const canEdit = !!onCellEdit
  const [failures, setFailures] = useState<CellEditFailure[] | null>(null)

  const keyboardCols = useMemo(() => [...leadingKeys, ...visibleKeys], [leadingKeys, visibleKeys])
  const canSelect = (row: R) => !isSelectable || isSelectable(row)
  const isExpandable = (row: R) => hasExpand && (canExpand?.(row) ?? true)
  const runAction = (action: GridKeyAction, rowId: string, key: string): boolean => {
    const row = rowById.get(rowId)
    if (!row) return false
    const col = byKey.get(key)
    switch (action) {
      case 'edit':
        return cellStore.requestEdit(rowId, key, { kind: 'end' })
      case 'activate': {
        if (key === CHECK_COL && !canSelect(row)) return false
        // Lien de la cellule : même geste que son clic (repo de la version, page de repli, ouverture
        // d'une exécution…), pas une résolution par l'index des ID nus.
        const link = cellLinkOf(containerRef.current, rowId, key)
        if (link) { link.click(); return true }
        const target = col?.elementId?.(row)
        if (target && nav) { nav.follow(target); return true }
        if (key === CHECK_COL) { select.checkbox(rowId, false); return true }
        if (onActivate && key !== EXPAND_COL) { onActivate(row); return true }
        if (isExpandable(row)) { toggleExpanded(rowId); return true }
        return false
      }
      case 'toggle':
        if (!hasCheck || !canSelect(row)) return false
        select.checkbox(rowId, false)
        return true
      case 'expand':
      case 'collapse':
        if (!isExpandable(row)) return false
        if ((action === 'expand') !== localExpanded.has(rowId)) toggleExpanded(rowId)
        return true
    }
  }
  const keyboard = useGridKeyboard(cellStore, containerRef, () => ({
    rows: renderedRows.map(r => ({ id: getRowId(r) })),
    cols: keyboardCols,
    frozenWidth: layout.frozenWidth,
    isEditable: cell => {
      const row = rowById.get(cell.rowId)
      const col = byKey.get(cell.col)
      return !!row && !!col && isEditableCell(canEdit, col, row)
    },
    expandCol: hasExpand ? EXPAND_COL : undefined,
    isExpanded: id => localExpanded.has(id),
  }), {
    selectRow: id => select.only(id),
    extendSelection: id => select.extendTo(id),
    action: (action, cell) => runAction(action, cell.rowId, cell.col),
    escape: () => select.clear(),
  })

  // Actions des cellules : implémentation recréée à chaque rendu, exposée par un objet stable.
  const impl: GridActions = {
    edit: (rowId, key, value) => {
      if (!onCellEdit) return
      const col = byKey.get(key)
      const inSelection = selectionMode === 'rows' && selected.size > 1 && selected.has(rowId)
      const ids = inSelection
        ? filteredRows.filter(r => selected.has(getRowId(r)) && !!col && isEditableCell(canEdit, col, r)).map(getRowId)
        : [rowId]
      setFailures(null)
      void onCellEdit(ids, key, value).then(r => setFailures(r.failed.length > 0 ? r.failed : null))
    },
    tab: (rowId, key, shift) => { keyboard.move({ rowId, col: key }, { key: 'Tab', shift }) },
    rowClick: (rowId, e) => {
      const row = rowById.get(rowId)
      if (hasCheck && row && !canSelect(row)) return
      select.click(rowId, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })
    },
    rowDoubleClick: rowId => { const row = rowById.get(rowId); if (row && onActivate) onActivate(row) },
    checkbox: (rowId, shift) => select.checkbox(rowId, shift),
    toggleExpanded,
  }
  const implRef = useRef(impl)
  implRef.current = impl
  const actions = useMemo<GridActions>(() => ({
    edit: (r, k, v) => implRef.current.edit(r, k, v),
    tab: (r, k, s) => implRef.current.tab(r, k, s),
    rowClick: (r, e) => implRef.current.rowClick(r, e),
    rowDoubleClick: r => implRef.current.rowDoubleClick(r),
    checkbox: (r, s) => implRef.current.checkbox(r, s),
    toggleExpanded: r => implRef.current.toggleExpanded(r),
  }), [])

  // ── Hauteur des lignes ──────────────────────────────────────────────────────
  const [rowMaxLines, setRowMaxLines] = useState(readExcelRowMaxLines)
  const changeRowMaxLines = useCallback((v: number) => { setRowMaxLines(v); writeExcelRowMaxLines(v) }, [])

  // ── Panneau 👁, vues enregistrées, export ───────────────────────────────────
  const pickerGroups = useMemo<ChecklistGroup[]>(() => {
    const groups: ChecklistGroup[] = []
    for (const c of columns) {
      let g = groups.find(x => x.label === c.group)
      if (!g) groups.push(g = { label: c.group, columns: [] })
      g.columns.push({ key: c.key, label: c.label })
    }
    return groups
  }, [columns])
  const lockedHints = useMemo(
    () => Object.fromEntries(columns.filter(c => c.locked).map(c => [c.key, t('grid.lockedColumn')])),
    [columns, t],
  )
  const columnsOf = (settings: Record<string, unknown>): string[] => {
    const list = settings[view]
    return normalize(Array.isArray(list) && list.every(s => typeof s === 'string') ? list as string[] : ('local' in prefSource ? [] : prefSource.defaults))
  }
  const repoPath = 'local' in prefSource ? '' : prefSource.repoPath
  const savedViewsMenu = savedViews && repoPath ? (
    <SavedViewsMenu
      repoPath={repoPath}
      username={prefs.username}
      typeKey={savedViews.typeKey}
      workspaceDir={savedViews.workspaceDir}
      settings={{ [view]: visibleKeys }}
      active={prefs.activeView}
      isModified={settings => columnsOf(settings).join('\n') !== visibleKey}
      onApply={(v: SavedView & { ref: SavedViewRef }) => prefs.applyView(columnsOf(v.settings), v.ref)}
      onActiveChange={ref => prefs.setActiveView(ref)}
      onDefaults={() => prefs.reset()}
    />
  ) : undefined
  const exportRepo = exportRepoPath ?? repoPath
  const exportTable = !noExport && exportRepo ? {
    repoPath: exportRepo,
    title,
    getPayload: () => buildTablePayload(
      title,
      shownCols.map(c => ({ key: c.key, label: c.label, text: c.exportText ?? c.getText, hyperlink: c.hyperlink })),
      filteredRows, layout.widthByKey, layout.freezeCount,
    ),
  } : undefined

  // Préférences pas encore lues : le conteneur défilant est rendu quand même (vide) — la mémoire du
  // défilement (GH300) s'y attache au montage.
  const loaded = prefs.loaded
  const effectiveMaxLines = rowMaxLines >= ROW_MAX_LINES_ALL ? Infinity : rowMaxLines
  const colCount = leadingKeys.length + shownCols.length
  const checkState = hasCheck ? groupState(selectableIds, selected) : 'none'
  const filterPopoverCol = filters.popover?.column

  return (
    <div className="flex flex-col gap-2 min-h-0 flex-1" data-testid={`${gridId}-datagrid`}>
      {loaded && !compact && (
        <GridToolbar
          gridId={gridId}
          start={toolbarStart}
          onColumns={noColumnPicker ? undefined : () => setPickerOpen(true)}
          savedViews={savedViewsMenu}
          rowMaxLines={rowMaxLines}
          onRowMaxLines={changeRowMaxLines}
          exportTable={exportTable}
          shown={filteredRows.length}
          total={rows.length}
        />
      )}
      {failures && (
        <p className="text-xs text-status-danger whitespace-pre-wrap" role="alert" data-testid={`${gridId}-bulk-error`}>
          {t('grid.bulkFailed', { count: failures.length })}
          {failures.map(f => `\n${f.id} : ${f.message}`).join('')}
        </p>
      )}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto outline-none border border-edge rounded"
        data-excel-grid
        data-view-scroll
        tabIndex={0}
        onKeyDown={keyboard.onKeyDown}
        onClick={() => { cellStore.select(null); select.clear() }}
      >
        <ExcelCellStoreContext.Provider value={cellStore}>
        <GridActionsContext.Provider value={actions}>
        <RowMaxLinesContext.Provider value={effectiveMaxLines}>
          {loaded && <table
            className="text-xs border-separate"
            style={{ width: layout.totalWidth, minWidth: '100%', tableLayout: 'fixed', borderSpacing: 0 }}
            data-testid={`${gridId}-grid`}
          >
            <thead className="sticky top-0 z-10">
              <tr>
                {hasExpand && <th className="border border-edge bg-hover" style={{ width: EXPAND_COL_WIDTH, position: 'sticky', left: 0, zIndex: 3 }} />}
                {hasCheck && (
                  <th className="border border-edge bg-hover px-1 text-left" style={{ width: CHECK_COL_WIDTH, position: 'sticky', left: hasExpand ? EXPAND_COL_WIDTH : 0, zIndex: 3 }}>
                    <input
                      type="checkbox"
                      className="rounded align-middle"
                      ref={el => { if (el) el.indeterminate = checkState === 'some' }}
                      checked={checkState === 'all'}
                      disabled={checkState === 'disabled'}
                      title={t('system.excelView.selectAllVisible')}
                      onChange={() => onSelectionChange(toggleGroup(selectableIds, selected))}
                      onClick={e => e.stopPropagation()}
                      data-testid={`${gridId}-check-all`}
                    />
                  </th>
                )}
                {shownCols.map((c, i) => (
                  <GridHeaderCell
                    key={c.key}
                    col={c.key}
                    colIdx={i}
                    label={c.label}
                    width={i === shownCols.length - 1 ? undefined : layout.widths[i]}
                    frozenLeft={i < layout.freezeCount ? (layout.freezeStyles[i]?.left as number) : undefined}
                    filterable={!compact && c.filterable !== false}
                    filtered={filters.activeKeys.has(c.key)}
                    reorderable={!compact && !noReorder}
                    dragging={layout.draggingCol === c.key}
                    dropSide={layout.dropTarget?.col === c.key ? layout.dropTarget.side : undefined}
                    testId={`${gridId}-header-${c.key}`}
                    onFilterClick={filters.togglePopover}
                    onResizeStart={layout.startResize}
                    drag={layout.headerDrag}
                    onFreezeMenu={openFreezeMenu}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-3 py-6 text-center text-ink-3 text-xs">{t('common.noElements')}</td>
                </tr>
              )}
              {renderedRows.map(row => {
                const id = getRowId(row)
                const isOpen = localExpanded.has(id)
                return (
                  <React.Fragment key={id}>
                    <GridRow
                      gridId={gridId}
                      row={row}
                      rowId={id}
                      cols={shownCols}
                      hasExpand={hasExpand}
                      expandable={isExpandable(row)}
                      hasCheck={hasCheck}
                      checkable={hasCheck && canSelect(row)}
                      expanded={isOpen}
                      selected={selected.has(id)}
                      canEdit={canEdit}
                      freezeStyles={layout.freezeStyles}
                      className={rowClassName?.(row)}
                    />
                    {isOpen && renderExpanded && isExpandable(row) && (
                      <tr data-expanded-of={id}>
                        <td colSpan={colCount} className="border border-edge p-0 bg-surface" onClick={e => e.stopPropagation()}>
                          <div className="px-3 py-2">{renderExpanded(row)}</div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>}
        </RowMaxLinesContext.Provider>
        </GridActionsContext.Provider>
        </ExcelCellStoreContext.Provider>
      </div>

      {filters.popover && filterPopoverCol && (
        <ColumnFilterPopover
          top={filters.popover.top}
          left={filters.popover.left}
          value={filters.filters[filterPopoverCol]}
          onChange={next => filters.setFilter(filterPopoverCol, next)}
          onClose={filters.closePopover}
        />
      )}
      {freezeMenu && (
        <ColumnFreezeMenu
          x={freezeMenu.x}
          y={freezeMenu.y}
          colIdx={freezeMenu.colIdx}
          freezeColCount={layout.freezeCount}
          onFreeze={prefs.setFreezeCount}
          onUnfreeze={() => prefs.setFreezeCount(0)}
          onClose={() => setFreezeMenu(null)}
        />
      )}
      {pickerOpen && (
        <ColumnPickerPanel
          groups={pickerGroups}
          shown={visibleKeys}
          locked={lockedHints}
          onChange={prefs.setColumns}
          onReset={prefs.reset}
          onClose={() => setPickerOpen(false)}
          testIdPrefix={`${gridId}-column`}
          layer={layer}
        />
      )}
    </div>
  )
}

// ── Ligne et cellules (mémoïsées : props primitives ou stables) ─────────────

const GridRowInner = function GridRow<R>({ gridId, row, rowId, cols, hasExpand, expandable, hasCheck, checkable, expanded, selected, canEdit, freezeStyles, className }: {
  gridId: string
  row: R
  rowId: string
  cols: readonly GridColumn<R>[]
  hasExpand: boolean
  expandable: boolean
  hasCheck: boolean
  checkable: boolean
  expanded: boolean
  selected: boolean
  canEdit: boolean
  freezeStyles: CSSProperties[]
  className?: string
}) {
  const actions = useGridActions()
  const stickyBg = selected ? 'bg-status-info-bg' : 'bg-surface group-hover:bg-row-hover'
  return (
    <tr
      data-node-id={rowId}
      data-selected={selected ? '' : undefined}
      data-testid={`${gridId}-row-${rowId}`}
      className={['group cursor-pointer scroll-mt-8 select-none align-top', selected ? 'bg-status-info-bg' : 'hover:bg-row-hover', className ?? ''].join(' ')}
      onClick={e => { e.stopPropagation(); actions.rowClick(rowId, e) }}
      onDoubleClick={() => actions.rowDoubleClick(rowId)}
    >
      {hasExpand && <ExpandCell gridId={gridId} rowId={rowId} expandable={expandable} expanded={expanded} stickyBg={stickyBg} />}
      {hasCheck && <CheckCell gridId={gridId} rowId={rowId} checkable={checkable} checked={selected} stickyBg={stickyBg} left={hasExpand ? EXPAND_COL_WIDTH : 0} />}
      {cols.map((c, i) => (
        <GridCell
          key={c.key}
          gridId={gridId}
          row={row}
          rowId={rowId}
          col={c}
          editable={isEditableCell(canEdit, c, row)}
          freezeStyle={freezeStyles[i]}
          stickyBg={freezeStyles[i] ? stickyBg : undefined}
        />
      ))}
    </tr>
  )
}
const GridRow = memo(GridRowInner) as typeof GridRowInner

const ExpandCell = memo(function ExpandCell({ gridId, rowId, expandable, expanded, stickyBg }: { gridId: string; rowId: string; expandable: boolean; expanded: boolean; stickyBg: string }) {
  const actions = useGridActions()
  const g = useCellGestures(rowId, EXPAND_COL)
  return (
    <td
      data-col={EXPAND_COL}
      data-active={g.isSelected || undefined}
      style={{ position: 'sticky', left: 0, zIndex: 2 }}
      className={['border border-edge px-1 text-center', stickyBg, g.isSelected ? CELL_SELECTED_CLASS : ''].join(' ')}
      onClick={g.onClick}
    >
      {expandable && <button
        type="button"
        className="text-ink-3 hover:text-ink align-middle"
        aria-expanded={expanded}
        aria-label={rowId}
        data-testid={`${gridId}-toggle-${rowId}`}
        data-cell-dblclick-ignore
        // Le focus reste sur la grille (clavier) : le chevron ne le prend pas au clic.
        onMouseDown={e => e.preventDefault()}
        onClick={e => { e.stopPropagation(); g.onClick(); actions.toggleExpanded(rowId) }}
        onDoubleClick={e => e.stopPropagation()}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>}
    </td>
  )
})

const CheckCell = memo(function CheckCell({ gridId, rowId, checkable, checked, stickyBg, left }: { gridId: string; rowId: string; checkable: boolean; checked: boolean; stickyBg: string; left: number }) {
  const actions = useGridActions()
  const g = useCellGestures(rowId, CHECK_COL)
  return (
    <td data-col={CHECK_COL} data-active={g.isSelected || undefined} style={{ position: 'sticky', left, zIndex: 2 }} className={['border border-edge px-1', stickyBg, g.isSelected ? CELL_SELECTED_CLASS : ''].join(' ')}>
      {checkable && <input
        type="checkbox"
        className="rounded align-middle"
        checked={checked}
        readOnly
        data-testid={`${gridId}-check-${rowId}`}
        onMouseDown={e => e.preventDefault()}
        onClick={e => { e.stopPropagation(); g.onClick(); actions.checkbox(rowId, e.shiftKey) }}
      />}
    </td>
  )
})

const GridCellInner = function GridCell<R>({ gridId, row, rowId, col, editable, freezeStyle, stickyBg }: {
  gridId: string
  row: R
  rowId: string
  col: GridColumn<R>
  editable: boolean
  freezeStyle?: CSSProperties
  stickyBg?: string
}) {
  const actions = useGridActions()
  const clamp = useCellClamp()
  const [editing, setEditing] = useState(false)
  const g = useCellGestures(rowId, col.key, editable ? () => setEditing(true) : undefined)
  const testId = `${gridId}-${col.key}-${rowId}`
  const base = 'border border-edge px-2 py-1 text-xs text-ink max-w-xs'

  if (editing && col.editor?.kind === 'enum') {
    const value = col.editValue?.(row) ?? col.getText(row)
    return (
      <td data-col={col.key} data-testid={testId} style={freezeStyle} className={['border border-edge p-0', stickyBg ?? ''].join(' ')}>
        <select
          autoFocus
          ref={openPicker}
          value={value}
          onChange={e => {
            if (e.target.value !== value) actions.edit(rowId, col.key, e.target.value)
            refocusGrid(e.currentTarget)
            setEditing(false)
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Escape') { refocusGrid(e.currentTarget); setEditing(false) }
            else if (e.key === 'Tab') { e.preventDefault(); refocusGrid(e.currentTarget); setEditing(false); actions.tab(rowId, col.key, e.shiftKey) }
          }}
          onClick={e => e.stopPropagation()}
          className="w-full px-2 py-1 text-xs text-ink bg-surface border-0 outline-none"
          data-testid={`${testId}-editor`}
        >
          {col.editor.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
    )
  }

  if (editing) {
    const value = col.editValue?.(row) ?? col.getText(row)
    return (
      <td data-col={col.key} data-testid={testId} style={freezeStyle} className={[base, stickyBg ?? '', CELL_SELECTED_CLASS].join(' ')}>
        <ExcelTextEditor
          initialValue={value}
          multiline={false}
          onCommit={v => {
            if (v !== value) actions.edit(rowId, col.key, v)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
          onTab={shift => actions.tab(rowId, col.key, shift)}
        />
      </td>
    )
  }

  const content = col.render ? col.render(row) : col.getText(row)
  return (
    <td
      data-col={col.key}
      data-testid={testId}
      data-active={g.isSelected || undefined}
      style={freezeStyle}
      className={[base, clamp.tdClass, stickyBg ?? '', editable ? `cursor-text ${CELL_EDITABLE_CLASS}` : '', g.isSelected ? CELL_SELECTED_CLASS : ''].join(' ')}
      onClick={g.onClick}
      onMouseDown={g.onMouseDown}
      onDoubleClick={g.onDoubleClick}
    >
      {clamp.wrap(content)}
    </td>
  )
}
const GridCell = memo(GridCellInner) as typeof GridCellInner

/** Lien affiché par une cellule (lien d'élément, lien de page, action de cellule `data-cell-link`). */
function cellLinkOf(container: HTMLElement | null, rowId: string, key: string): HTMLElement | null {
  const cell = container?.querySelector(`tr[data-node-id="${CSS.escape(rowId)}"] > td[data-col="${CSS.escape(key)}"]`)
  return cell?.querySelector<HTMLElement>('[data-element-link], [data-page-link], [data-cell-link]') ?? null
}

/** Liste d'un éditeur enum ouverte une seule fois, au montage (ref stable) ; refusée sans geste de l'utilisateur. */
function openPicker(el: HTMLSelectElement | null): void {
  if (!el) return
  try {
    el.showPicker?.()
  } catch { /* pas d'activation utilisateur : la liste reste fermée, le clavier la parcourt */ }
}
