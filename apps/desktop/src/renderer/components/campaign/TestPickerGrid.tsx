import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ObjectLink, ObjectTypeDefinition, TestCase } from '@polenta/types'
import { api } from '../../api'
import { ExcelView, type ExcelSelectionMode } from '../system/ExcelView'
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
 */
export function TestPickerGrid({
  repoPath,
  typeRef,
  typeDef,
  tests,
  username,
  filter,
  filterOptions,
  selection,
}: {
  repoPath: string
  /** `<nœud>::<type>` */
  typeRef: string
  typeDef: ObjectTypeDefinition
  /** Tests proposés de ce type (règles d'éligibilité appliquées par l'appelant). */
  tests: TestCase[]
  username: string
  filter: string
  filterOptions: FilterOptions
  selection: ExcelSelectionMode
}) {
  const { t } = useTranslation()
  const [nodeId, typeId] = typeRef.split('::')

  // Mêmes clés de cache que SystemViewContext / SystemView.
  const { data: tree, isPending: treePending } = useQuery({
    queryKey: ['tree', repoPath, nodeId, typeId],
    queryFn: () => api.tree.get(repoPath, nodeId!, typeId!),
    enabled: !!repoPath && !!nodeId && !!typeId,
  })
  const { data: prefs, isPending: prefsPending } = useQuery({
    queryKey: ['pref-visibility', repoPath, username, typeRef],
    queryFn: () => api.pref.getFieldVisibility(repoPath, username, typeRef),
    enabled: !!repoPath && !!username,
  })
  const { data: allLinks = [] } = useQuery({
    queryKey: ['links-all', repoPath],
    queryFn: () => api.requirements.linksAll(repoPath),
    enabled: !!repoPath,
  })
  const { data: schema } = useProjectSchema(repoPath)

  // Copies locales, initialisées depuis les préférences une fois chargées.
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([])
  const [freezeColCount, setFreezeColCount] = useState(0)
  useEffect(() => {
    if (prefsPending) return
    setCollapsedFolders(prefs?.collapsedFoldersExcel ?? [])
    setFreezeColCount(prefs?.freezeColCountExcel ?? 0)
  }, [prefs, prefsPending])

  const [rowMaxLines] = useState(readExcelRowMaxLines)

  const root = useMemo(() => {
    const titles = new Map(tests.map(tc => [tc.id, tc.title]))
    return pruneTree(tree?.root ?? [], new Set(tests.map(tc => tc.id)), titles)
  }, [tree, tests])
  // Numérotation de la vue système : calculée sur l'arbre complet, pas sur l'arbre élagué.
  const sectionNumbers = useMemo(() => computeSectionNumbers(tree?.root ?? []), [tree])
  const objects = useMemo(() => tests.map(normalizeObject), [tests])
  const stepsByObjectId = useMemo(() => {
    const map = new Map<string, { action: string; expectedResult: string }[]>()
    for (const tc of tests) {
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
    <ExcelView
      // Changement de type : filtres colonne (état local T51) et ancre réinitialisés.
      key={typeRef}
      root={root}
      typeDef={typeDef}
      objects={objects}
      visibleFields={prefs?.excel ?? defaultVisibleFields(typeDef)}
      foldersHidden={!(prefs?.showFoldersExcel ?? true)}
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
    />
  )
}
