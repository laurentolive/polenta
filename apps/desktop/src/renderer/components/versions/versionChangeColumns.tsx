import type { MutableRefObject } from 'react'
import type { TFunction } from 'i18next'
import { FileDiff, X } from 'lucide-react'
import type { VersionChangeRow } from '@polenta/types'
import { ElementLink } from '../element/ElementLink'
import { PageLink } from '../element/PageLink'
import type { GridColumn } from '../grid/gridTypes'

/** Colonnes visibles par défaut de la grille des changements d'une version. */
export const VERSION_CHANGE_DEFAULTS = ['component', 'version', 'type', 'id', 'label', 'diff', 'actions']

/** Colonnes de gestes : sans texte, jamais exportées. */
export const VERSION_CHANGE_GESTURE_COLUMNS: readonly string[] = ['diff', 'actions']

/** Identifiant de ligne : un même élément peut figurer dans la version et dans celle d'un composant, et
 *  deux repos peuvent avoir une version de même ID (composant = nom de montage, unique). */
export const versionChangeRowKey = (r: VersionChangeRow) => `${r.component}:${r.versionId}:${r.id}`

export interface VersionChangeGestures {
  openDiff(r: VersionChangeRow): void
  openVersion(r: VersionChangeRow): void
  onRemove?(ids: string[]): void
}

/** Gestes inertes (export : les colonnes ne servent qu'à lire le texte affiché). */
export const INERT_CHANGE_GESTURES: MutableRefObject<VersionChangeGestures> = { current: { openDiff: () => {}, openVersion: () => {} } }

/**
 * GH201 §5, GH389 §4 — colonnes des changements d'une version, partagées par la grille et par l'export de la
 * page (GH439) : le texte exporté est celui de l'écran. Gestes lus par une ref : colonnes stables.
 */
export function buildVersionChangeColumns({ t, gestures, removable }: {
  t: TFunction
  gestures: MutableRefObject<VersionChangeGestures>
  /** Version en cours, modifiable : « Retirer » sur ses propres lignes. */
  removable: boolean
}): GridColumn<VersionChangeRow>[] {
  return [
    { key: 'component', label: t('versions.columns.component'), getText: r => r.componentLabel },
    {
      key: 'version', label: t('versions.columns.version'),
      getText: r => `${r.versionTitle} (${r.versionId})`,
      render: r => (
        <PageLink id={r.versionId} repoPath={r.repoPath} className="text-prim" onFallback={() => gestures.current.openVersion(r)}>
          {r.versionTitle} <span className="text-ink-3">({r.versionId})</span>
        </PageLink>
      ),
    },
    {
      key: 'type', label: t('versions.columns.type'),
      getText: r => (r.category ? t(`versions.category.${r.category}`) : t('versions.page.deleted')),
      render: r => (r.category ? t(`versions.category.${r.category}`) : <span className="italic text-ink-3">{t('versions.page.deleted')}</span>),
    },
    {
      key: 'id', label: t('versions.columns.id'), locked: true,
      getText: r => r.id,
      render: r => (r.category ? <ElementLink id={r.id} className="font-mono text-prim" /> : <span className="font-mono text-ink-3">{r.id}</span>),
      elementId: r => (r.category ? r.id : undefined),
    },
    {
      key: 'label', label: t('versions.columns.label'),
      getText: r => [r.title, !r.base && r.category ? t('versions.backlog.kind.new') : ''].filter(Boolean).join(' '),
      render: r => <>{r.title}{!r.base && r.category && <span className="ml-2 text-[10px] text-status-info">{t('versions.backlog.kind.new')}</span>}</>,
    },
    {
      key: 'diff', label: t('versions.columns.diff'), filterable: false,
      getText: r => (r.filePath ? t('versions.seeChanges') : ''),
      render: r => r.filePath && (
        <button type="button" data-cell-link data-cell-dblclick-ignore onClick={e => { e.stopPropagation(); gestures.current.openDiff(r) }}
          className="inline-flex items-center gap-1 text-prim hover:underline" data-testid={`version-diff-${r.id}`}>
          <FileDiff size={12} />{t('versions.seeChanges')}
        </button>
      ),
    },
    // Toujours proposée (vide sur une version figée) : la liste de colonnes enregistrée, commune à
    // toutes les versions, la garde d'une version à l'autre.
    {
      key: 'actions', label: t('versions.columns.actions'), filterable: false,
      getText: () => '',
      render: (r: VersionChangeRow) => removable && r.own && (
        <button type="button" data-cell-dblclick-ignore onClick={e => { e.stopPropagation(); gestures.current.onRemove?.([r.id]) }}
          className="btn-icon text-ink-3 hover:text-status-danger" title={t('versions.page.remove')} data-testid={`version-remove-${r.id}`}>
          <X size={12} />
        </button>
      ),
    },
  ]
}
