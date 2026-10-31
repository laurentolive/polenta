import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ObjectLink, ObjectTypeDefinition, Requirement, TestCase } from '@polenta/types'
import type { FieldVisibilityPatch, FieldVisibilityPref } from '@polenta/api-client'
import { useComputedColumns } from '../../hooks/useComputedColumns'
import { api } from '../../api'
import { ExcelView, type ExcelSelectionMode } from '../system/ExcelView'
import { FieldConfigModal } from '../system/FieldConfigModal'
import { ROW_MAX_LINES_ALL, readExcelRowMaxLines } from '../system/RowMaxHeightButton'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { computeSectionNumbers } from '../../hooks/useTreeState'
import { normalizeObject } from '../../lib/normalizeObject'
import { defaultVisibleFields } from '../../lib/exportColumns'
import { pruneTree } from '../../lib/gridSelection'
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
  username,
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
  tests: Array<TestCase | Requirement>
  /** Catégorie du type (`test` par défaut) : étapes et colonnes calculées. */
  category?: 'test' | 'requirement'
  username: string
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
  const prefsKey = useMemo(() => ['pref-visibility', repoPath, username, typeRef], [repoPath, username, typeRef])
  const { data: prefs, isPending: prefsPending } = useQuery({
    queryKey: prefsKey,
    queryFn: () => api.pref.getFieldVisibility(repoPath, username, typeRef),
    enabled: !!repoPath && !!username,
  })
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
  const initializedFor = useRef<string | null>(null)
  useEffect(() => {
    const key = prefsKey.join('|')
    if (prefsPending || initializedFor.current === key) return
    initializedFor.current = key
    setCollapsedFolders(prefs?.collapsedFoldersExcel ?? [])
    setFreezeColCount(prefs?.freezeColCountExcel ?? 0)
  }, [prefs, prefsPending, prefsKey])

  // GH176 — écriture partielle (le main fusionne, `null` supprime), appliquée d'abord au cache
  // partagé avec la Vue Système pour un affichage immédiat, puis relue : après une suppression,
  // seul le main sait à quoi l'entrée retombe (défaut de l'équipe, ou rien).
  const qc = useQueryClient()
  const savePrefs = useCallback((patch: FieldVisibilityPatch) => {
    // Une relecture en cours ramènerait la valeur d'avant ce changement.
    void qc.cancelQueries({ queryKey: prefsKey })
    qc.setQueryData<FieldVisibilityPref | null>(prefsKey, prev => {
      const next: Record<string, unknown> = { ...prev }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key]
        else if (value !== undefined) next[key] = value
      }
      return next as unknown as FieldVisibilityPref
    })
    api.pref.setFieldVisibility(repoPath, username, typeRef, patch)
      .catch(err => console.error('[TestPickerGrid] Enregistrement des colonnes du sélecteur :', err))
      .finally(() => { void qc.invalidateQueries({ queryKey: prefsKey }) })
  }, [qc, prefsKey, repoPath, username, typeRef])
  const onPickerFieldsChange = useCallback((fields: string[]) => savePrefs({ picker: fields }), [savePrefs])
  const onPickerFoldersChange = useCallback((show: boolean) => savePrefs({ showFoldersPicker: show }), [savePrefs])
  const onPickerReset = useCallback(() => savePrefs({ picker: null, showFoldersPicker: null }), [savePrefs])

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
