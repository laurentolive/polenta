import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Issue, ObjectLink, ObjectTypeDefinition, Requirement, TestCase } from '@polenta/types'
import type { FieldVisibilityPref } from '@polenta/api-client'
import { useComputedColumns } from '../../hooks/useComputedColumns'
import { api } from '../../api'
import { ExcelView, type ExcelSelectionMode } from '../system/ExcelView'
import { FieldConfigModal } from '../system/FieldConfigModal'
import { ROW_MAX_LINES_ALL, readExcelRowMaxLines } from '../system/RowMaxHeightButton'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { computeSectionNumbers } from '../../hooks/useTreeState'
import { normalizeObject } from '../../lib/normalizeObject'
import { defaultVisibleFields } from '../../lib/exportColumns'
import { pruneTree } from '../grid/rowSelection'
import { useGridPrefs } from '../grid/useGridPrefs'
import type { FilterOptions } from '../../lib/textFilter'

/**
 * GH33 — grille du sélecteur de tests d'une campagne, pour un type de test : Vue Excel en mode
 * sélection, avec les colonnes / l'arbre / les réglages de la Vue Excel de l'utilisateur pour ce
 * type. Repli des dossiers et colonnes figées partent des préférences mais restent locaux : rien
 * n'est jamais réécrit (la vue système n'est pas affectée par ce qu'on fait ici).
 *
 * GH176 — colonnes et titres de dossiers configurables (panneau ⚙️) : préférence propre au
 * sélecteur (`picker` / `showFoldersPicker`), qui suit la Vue Excel tant qu'elle est absente.
 *
 * GH198 — aussi pour les exigences (`category`), dans le sélecteur d'éléments d'un change.
 */
export function TestPickerGrid({
  repoPath,
  typeRef,
  typeDef,
  tests,
  category = 'test',
  workspaceDir,
  filter,
  filterOptions,
  selection,
  columnsOpen = false,
  onColumnsClose,
}: {
  repoPath: string
  /** `<nœud>::<type>` */
  typeRef: string
  typeDef: ObjectTypeDefinition
  /** Objets proposés de ce type (règles d'éligibilité appliquées par l'appelant). */
  tests: Array<TestCase | Requirement | Issue>
  /** Catégorie du type (`test` par défaut) : étapes et colonnes calculées. */
  category?: 'test' | 'requirement' | 'issue'
  /** GH70 — projet ouvert (colonnes calculées : requêtes partagées du projet). */
  workspaceDir: string
  filter: string
  filterOptions: FilterOptions
  selection: ExcelSelectionMode
  /** GH176 — panneau ⚙️ des colonnes ouvert (bouton de la modale). */
  columnsOpen?: boolean
  onColumnsClose?: () => void
}) {
  const { t } = useTranslation()
  const [nodeId, typeId] = typeRef.split('::')

  // Mêmes clés de cache que SystemViewContext / SystemView.
  const { data: tree, isPending: treePending } = useQuery({
    queryKey: ['tree', repoPath, nodeId, typeId],
    queryFn: () => api.tree.get(repoPath, nodeId!, typeId!),
    enabled: !!repoPath && !!nodeId && !!typeId,
  })
  // GH389 — préférences du type par la brique commune (`useGridPrefs`) : colonnes `picker`, et clés de
  // la Vue Excel du type (`excel`, largeurs, gel, dossiers) lues dans l'entrée brute.
  const gridPrefs = useGridPrefs(useMemo(() => ({ repoPath, prefKey: typeRef, view: 'picker', defaults: [] }), [repoPath, typeRef]))
  const prefs = gridPrefs.raw as FieldVisibilityPref | null
  const prefsPending = !gridPrefs.loaded
  const { data: allLinks = [] } = useQuery({
    queryKey: ['links-all', repoPath],
    queryFn: () => api.requirements.linksAll(repoPath),
    enabled: !!repoPath,
  })
  const { data: schema } = useProjectSchema(repoPath)

  // Copies locales, initialisées depuis les préférences une fois chargées — une fois par type :
  // l'enregistrement des colonnes (GH176) renouvelle `prefs` et ne doit pas les réinitialiser.
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([])
  const [freezeColCount, setFreezeColCount] = useState(0)
  // GH288 — largeurs de la vue Tableau du type, reprises sans être réenregistrées.
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const initializedFor = useRef<string | null>(null)
  useEffect(() => {
    const key = `${repoPath}|${typeRef}`
    if (prefsPending || initializedFor.current === key) return
    initializedFor.current = key
    setCollapsedFolders(prefs?.collapsedFoldersExcel ?? [])
    setFreezeColCount(prefs?.freezeColCountExcel ?? 0)
    setColWidths(prefs?.colWidthsExcel ?? {})
  },[prefs, prefsPending, repoPath, typeRef])

  // GH176 — écriture partielle (le main fusionne, `null` supprime), appliquée d'abord au cache
  // partagé avec la Vue Système pour un affichage immédiat, puis relue (`useGridPrefs.patch`).
  const { patch: savePrefs } = gridPrefs
  const onPickerFieldsChange = useCallback((fields: string[]) => { void savePrefs({ picker: fields }) }, [savePrefs])
  const onPickerFoldersChange = useCallback((show: boolean) => { void savePrefs({ showFoldersPicker: show }) }, [savePrefs])
  const onPickerReset = useCallback(() => { void savePrefs({ picker: null, showFoldersPicker: null }) }, [savePrefs])

  const [rowMaxLines] = useState(readExcelRowMaxLines)

  const root = useMemo(() => {
    const titles = new Map(tests.map(tc => [tc.id, tc.title]))
    return pruneTree(tree?.root ?? [], new Set(tests.map(tc => tc.id)), titles)
  }, [tree, tests])
  // Numérotation de la vue système : calculée sur l'arbre complet, pas sur l'arbre élagué.
  const sectionNumbers = useMemo(() => computeSectionNumbers(tree?.root ?? []), [tree])
  const normalized = useMemo(() => tests.map(normalizeObject), [tests])
  // GH176 — colonnes du sélecteur, à défaut celles de la Vue Excel du type.
  const pickerFields = useMemo(() => prefs?.picker ?? prefs?.excel ?? defaultVisibleFields(typeDef), [prefs, typeDef])
  const showFolders = prefs?.showFoldersPicker ?? prefs?.showFoldersExcel ?? true
  // GH68 — tout statut est proposé : la colonne Statut est toujours affichée (insérée après `id`
  // si les colonnes suivies la masquent), sans réécrire ces préférences.
  const prefFields = useMemo(() => withStatusColumn(pickerFields), [pickerFields])
  // GH70 — colonnes calculées visibles : affichées, sans ouverture. GH126 — panneau ⚙️ ouvert :
  // colonnes éclatées exécutées pour lister leurs sous-colonnes.
  const computed = useComputedColumns({ workspaceDir, category, objectTypeRef: typeRef, visibleKeys: prefFields, discover: columnsOpen })
  const computedColumns = computed.columnsMap
  const filterComputed = computed.filterFields
  const visibleFields = useMemo(() => filterComputed(prefFields), [prefFields, filterComputed])
  const mergeComputed = computed.merge
  const objects = useMemo(() => mergeComputed(normalized), [mergeComputed, normalized])
  const stepsByObjectId = useMemo(() => {
    const map = new Map<string, { action: string; expectedResult: string }[]>()
    for (const tc of tests) {
      if (!('steps' in tc)) continue
      map.set(tc.id, (tc.steps ?? []).slice().sort((a, b) => a.order - b.order).map(s => ({ action: s.action, expectedResult: s.expectedResult })))
    }
    return map
  }, [tests])
  const linksByObjectId = useMemo(() => {
    const map = new Map<string, ObjectLink[]>()
    for (const link of allLinks) {
      if (!map.has(link.sourceId)) map.set(link.sourceId, [])
      map.get(link.sourceId)!.push(link)
      if (!map.has(link.targetId)) map.set(link.targetId, [])
      map.get(link.targetId)!.push(link)
    }
    return map
  }, [allLinks])

  // Pas de grille montée pendant le chargement : aucune ligne affichée (compteur « non affichés »).
  const loading = treePending || prefsPending
  const onDisplayedChange = selection.onDisplayedChange
  useEffect(() => {
    if (loading) onDisplayedChange?.([])
  }, [loading, onDisplayedChange])

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">{t('common.loading')}</div>
  }

  return (
    <>
    <ExcelView
      // Changement de type : filtres colonne (état local T51) et ancre réinitialisés.
      key={typeRef}
      root={root}
      typeDef={typeDef}
      objects={objects}
      visibleFields={visibleFields}
      foldersHidden={!showFolders}
      sectionNumbers={sectionNumbers}
      linkTypes={schema?.linkTypes ?? []}
      linksByObjectId={linksByObjectId}
      repoPath={repoPath}
      stepsByObjectId={stepsByObjectId}
      filter={filter}
      filterOptions={filterOptions}
      rowMaxLines={rowMaxLines >= ROW_MAX_LINES_ALL ? Infinity : rowMaxLines}
      collapsedFolders={collapsedFolders}
      onCollapsedFoldersChange={setCollapsedFolders}
      freezeColCount={freezeColCount}
      onFreezeColCountChange={setFreezeColCount}
      colWidths={colWidths}
      onColWidthsChange={setColWidths}
      selection={selection}
      computedColumns={computedColumns}
    />
    {columnsOpen && (
      <FieldConfigModal
        typeDef={typeDef}
        objectTypeRef={typeRef}
        linkTypes={schema?.linkTypes ?? []}
        activeTab="excel"
        tabs={['excel']}
        layer="modal"
        visibleFieldsExcel={pickerFields}
        onChangeExcel={onPickerFieldsChange}
        showFoldersExcel={showFolders}
        onChangeShowFoldersExcel={onPickerFoldersChange}
        lockedFields={{ status: t('campaignPage.picker.statusAlwaysShown') }}
        onReset={onPickerReset}
        onClose={onColumnsClose ?? (() => {})}
        computedColumns={computed.available}
        computedPanel={computed.panel}
      />
    )}
    </>
  )
}

function withStatusColumn(fields: string[]): string[] {
  if (fields.includes('status')) return fields
  const at = fields.indexOf('id')
  return at === -1 ? ['status', ...fields] : [...fields.slice(0, at + 1), 'status', ...fields.slice(at + 1)]
}
