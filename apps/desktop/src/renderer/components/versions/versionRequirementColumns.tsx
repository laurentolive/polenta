import type { TFunction } from 'i18next'
import type { SchemaField, VersionRequirementRow, VersionRequirementsPage } from '@polenta/types'
import { fieldValueToText } from '@polenta/types'
import { ElementLink } from '../element/ElementLink'
import { ElementLinks } from '../element/ElementLinks'
import { htmlToCellText } from '../grid/cellText'
import type { GridColumn } from '../grid/gridTypes'
import { CLASS_BY_STATUS } from '../system/CoverageBadge'

// GH439 — colonnes de la section « Exigences » d'une version, partagées par la grille et par l'export de la page.

export const versionRequirementRowId = (r: VersionRequirementRow) => r.requirementId
const textOf = (v: unknown) => htmlToCellText(fieldValueToText(v))

/** Clé de la colonne d'un champ du schéma. */
export const requirementFieldKey = (name: string) => `field:${name}`

/**
 * Colonnes visibles par défaut : ID, titre, statut, les champs que le schéma marque `defaultVisible` (à défaut,
 * les trois premiers — comme la vue Tableau), puis la vérification.
 */
export function versionRequirementDefaults(fields: readonly SchemaField[]): string[] {
  const marked = fields.filter(f => f.defaultVisible)
  return ['id', 'title', 'status', ...(marked.length > 0 ? marked : fields.slice(0, 3)).map(f => requirementFieldKey(f.name)), 'coverageStatus']
}

/** Texte affiché de la vérification : libellé du statut, « — » quand la couverture n'est pas figée. */
export function coverageText(t: TFunction, row: VersionRequirementRow): string {
  return row.coverageStatus ? t(`system.coverage.status.${row.coverageStatus}`) : '—'
}

export function buildVersionRequirementColumns({ page, t }: { page: VersionRequirementsPage; t: TFunction }): GridColumn<VersionRequirementRow>[] {
  return [
    {
      key: 'id', label: t('versions.columns.id'), locked: true, getText: r => r.requirementId,
      render: r => <ElementLink id={r.requirementId} className="font-mono text-prim" />,
      elementId: r => r.requirementId,
    },
    { key: 'title', label: t('versions.requirements.columns.title'), getText: r => r.title },
    { key: 'status', label: t('versions.requirements.columns.status'), getText: r => page.requirementStatusLabels[r.status] ?? r.status },
    { key: 'objectTypeRef', label: t('versions.requirements.columns.type'), getText: r => page.requirementTypeLabels[r.objectTypeRef] ?? r.objectTypeRef },
    ...page.requirementFields.map((f): GridColumn<VersionRequirementRow> => ({
      key: requirementFieldKey(f.name), label: f.label || f.name, getText: r => textOf(r.fields[f.name]),
    })),
    { key: 'version', label: t('versions.requirements.columns.revision'), getText: r => String(r.version) },
    {
      key: 'coverageStatus', label: t('versions.requirements.columns.verification'), getText: r => coverageText(t, r),
      render: r => r.coverageStatus
        ? (
          <span className={`text-[10px] font-medium ${CLASS_BY_STATUS[r.coverageStatus]}`}
            title={r.tests.length > 0 ? r.tests.join('\n') : t('system.coverage.noLinkedTest')}>
            {t(`system.coverage.status.${r.coverageStatus}`)}
          </span>
        )
        : <span className="text-ink-3">—</span>,
    },
    {
      key: 'tests', label: t('versions.requirements.columns.tests'), getText: r => r.tests.join(', '),
      render: r => <ElementLinks ids={r.tests} />, elementId: r => r.tests[0],
    },
  ]
}
