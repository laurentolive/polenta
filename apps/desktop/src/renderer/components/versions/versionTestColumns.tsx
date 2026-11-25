import type { TFunction } from 'i18next'
import type { VersionTestToRun } from '@polenta/types'
import { ElementLink } from '../element/ElementLink'
import { ElementLinks } from '../element/ElementLinks'
import type { GridColumn } from '../grid/gridTypes'

/** Colonnes visibles par défaut de la grille des tests à exécuter d'une version. */
export const VERSION_TEST_DEFAULTS = ['id', 'label', 'requirements', 'via', 'alreadyIn']

export const versionTestRowId = (x: VersionTestToRun) => x.testId
const viaOf = (x: VersionTestToRun) => x.sources.filter(id => id !== x.testId)

/** GH245 §2, GH389 §4 — colonnes des tests à exécuter, partagées par la grille et par l'export de la page (GH439). */
export function buildVersionTestColumns({ t }: { t: TFunction }): GridColumn<VersionTestToRun>[] {
  return [
    {
      key: 'id', label: t('versions.columns.id'), locked: true, getText: x => x.testId,
      render: x => <ElementLink id={x.testId} className="font-mono text-prim" />, elementId: x => x.testId,
    },
    { key: 'label', label: t('versions.columns.label'), getText: x => x.title },
    {
      key: 'requirements', label: t('versions.columns.requirements'), getText: x => x.requirementIds.join(', '),
      render: x => <ElementLinks ids={x.requirementIds} />, elementId: x => x.requirementIds[0],
    },
    {
      key: 'via', label: t('versions.tests.via'), getText: x => viaOf(x).join(', '),
      render: x => <ElementLinks ids={viaOf(x)} />, elementId: x => viaOf(x)[0],
    },
    {
      key: 'alreadyIn', label: t('versions.tests.alreadyIn'), getText: x => x.alreadyIn.map(c => c.id).join(', '),
      render: x => <ElementLinks ids={x.alreadyIn.map(c => c.id)} />, elementId: x => x.alreadyIn[0]?.id,
    },
  ]
}
