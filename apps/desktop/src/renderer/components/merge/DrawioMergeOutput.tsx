import { useTranslation } from 'react-i18next'
import { findRegions, type Side } from '@polenta/merge-core'
import { DrawioPageView } from '../diff/DrawioFileDiffView'

/**
 * GH222 — sortie d'un merge de `.drawio` en mode Rendu : une carte par page en conflit (bloc
 * `page:<id>`), avec la page rendue de chaque côté (à son commit) et le choix gauche / droite.
 * Les pages fusionnées sans conflit sont déjà dans la sortie ; l'édition fine reste en Raw.
 */
export function DrawioMergeOutput({ text, repoPath, filepath, leftAt, rightAt, onTake }: {
  text: string
  repoPath: string
  filepath: string
  leftAt: string
  rightAt: string
  onTake: (key: string, side: Side) => void
}) {
  const { t } = useTranslation()
  const { regions, error } = findRegions(text)
  if (error) return <p className="p-4 text-xs text-status-warning">{t('mergeResolve.renderUnavailable')}</p>
  // Every open block: a page (`page:<id>`), or a line hunk when the file could not be read page by
  // page (merged as text) — the latter without preview.
  if (regions.length === 0) return <p className="p-4 text-xs text-ink-3 italic">{t('diffkit.conflict.none')}</p>
  return (
    <div className="h-full overflow-auto p-3 space-y-3" data-testid="drawio-merge">
      {regions.map(r => {
        const pageId = r.key.startsWith('page:') ? r.key.slice('page:'.length) : null
        return (
          <section key={`${r.key}:${r.start}`} data-unit={r.key} className="rounded border-l-[3px] border-diff-conflict bg-diff-conflict-bg p-2">
            <p className="text-[11px] font-semibold text-status-warning mb-2">
              {pageId ? t('mergeResolve.drawioPage', { page: pageId }) : t('mergeResolve.drawioHunk', { key: r.key })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['left', 'right'] as const).map(side => (
                <div key={side} className="min-w-0 bg-surface rounded border border-edge p-2">
                  <button type="button" className="btn-secondary-sm mb-1" onClick={() => onTake(r.key, side)}>
                    {side === 'left' ? t('mergeResolve.takeLeft') : t('mergeResolve.takeRight')}
                  </button>
                  {pageId && <DrawioPageView repoPath={repoPath} filepath={filepath} pageId={pageId} at={side === 'left' ? leftAt : rightAt} />}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
