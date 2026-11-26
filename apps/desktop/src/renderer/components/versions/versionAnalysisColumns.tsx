import type { TFunction } from 'i18next'
import type { VersionImpactRow } from '@polenta/types'
import { IMPACT_ANALYSIS_STATUSES } from '@polenta/types'
import { CLOSED_STATUSES, STATUS_LABEL_KEY } from '../../lib/impactStatus'
import { ElementLink } from '../element/ElementLink'
import type { GridColumn } from '../grid/gridTypes'

/** Colonnes visibles par défaut du tableau des lignes de l'analyse d'impact d'une version. */
export const VERSION_ANALYSIS_DEFAULTS = ['id', 'label', 'status', 'comment', 'source']

export const versionImpactRowId = (r: VersionImpactRow) => r.id
export const versionImpactRowClass = (r: VersionImpactRow) => (r.reached ? undefined : 'opacity-60')

const pathText = (src: VersionImpactRow['sources'][number]) => [src.rootId, ...src.path.map(p => p.id)].join(' → ')

/**
 * GH245 §1, GH389 §4 — colonnes du tableau de l'analyse (version figée, ou statuts hors arbres d'une analyse en
 * cours), partagées par la grille et par l'export de la page (GH439). `titleOf` : titres des éléments de la source
 * (infobulle).
 */
export function buildVersionAnalysisColumns({ t, titleOf }: { t: TFunction; titleOf: Map<string, string> }): GridColumn<VersionImpactRow>[] {
  return [
    {
      key: 'id', label: t('versions.columns.id'), locked: true, getText: r => r.id,
      render: r => (r.elementType ? <ElementLink id={r.id} className="font-mono text-prim" /> : <span className="font-mono text-ink-3">{r.id}</span>),
      elementId: r => (r.elementType ? r.id : undefined),
    },
    {
      key: 'label', label: t('versions.columns.label'),
      getText: r => [r.title ?? '', r.reached ? '' : t('versions.analysis.notReached')].filter(Boolean).join(' '),
      render: r => <>{r.title}{!r.reached && <span className="ml-2 text-[10px] text-ink-3 italic">{t('versions.analysis.notReached')}</span>}</>,
    },
    {
      key: 'status', label: t('versions.analysis.status'),
      getText: r => t(STATUS_LABEL_KEY[r.status]),
      render: r => <span className={CLOSED_STATUSES.has(r.status) ? 'text-status-success' : 'text-ink-2'}>{t(STATUS_LABEL_KEY[r.status])}</span>,
      editValue: r => r.status,
      editor: { kind: 'enum', options: IMPACT_ANALYSIS_STATUSES.map(st => ({ value: st, label: t(STATUS_LABEL_KEY[st]) })) },
    },
    { key: 'comment', label: t('versions.analysis.comment'), getText: r => r.comment ?? '', editor: { kind: 'text' } },
    {
      key: 'source', label: t('versions.analysis.source'),
      getText: r => r.sources.map(pathText).join(' ; '),
      render: r => {
        const [first, ...others] = r.sources
        return first && (
          <span className="font-mono text-[11px] text-ink-3"
            title={r.sources.map(src => [src.rootId, ...src.path.map(p => p.id)].map(id => `${id} ${titleOf.get(id) ?? ''}`.trim()).join(' → ')).join('\n')}>
            {pathText(first)}{others.length > 0 && <span className="ml-1 text-ink-2">+{others.length}</span>}
          </span>
        )
      },
    },
  ]
}
