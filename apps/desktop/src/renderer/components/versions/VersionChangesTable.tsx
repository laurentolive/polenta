import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { FileDiff, X } from 'lucide-react'
import type { VersionChangeRow } from '@polenta/types'

/** GH201 §5 — changements d'une version (les siens, puis ceux des versions des composants). */
export function VersionChangesTable({ rows, projectId, onRemove }: {
  rows: VersionChangeRow[]
  projectId: string
  /** Version en cours, modifiable : « Retirer » sur ses propres lignes. */
  onRemove?: (id: string) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (rows.length === 0) return <p className="text-xs text-ink-3 italic">{t('versions.page.noChanges')}</p>

  const openElement = (r: VersionChangeRow) => {
    if (r.category === 'requirement') void navigate({ to: '/req/$reqId', params: { reqId: r.id }, search: { repoPath: r.repoPath, projectId, component: undefined, level: undefined } })
    else if (r.category === 'test') void navigate({ to: '/test/$testId', params: { testId: r.id }, search: { repoPath: r.repoPath, projectId, component: undefined, level: undefined } })
  }
  const openDiff = (r: VersionChangeRow) => {
    if (!r.filePath) return
    void navigate({
      to: '/diff',
      search: {
        projectId, repoPath: r.repoPath, filepath: r.filePath, commitSha: undefined, element: '1',
        ...(r.base && { baseSha: r.base.sha }), ...(r.toSha && { toSha: r.toSha }),
      },
    })
  }

  return (
    <table className="w-full text-xs border-collapse" data-testid="version-changes">
      <thead>
        <tr className="text-left text-ink-3 border-b border-edge">
          <th className="py-1 pr-3 font-medium">{t('versions.columns.component')}</th>
          <th className="py-1 pr-3 font-medium">{t('versions.columns.version')}</th>
          <th className="py-1 pr-3 font-medium">{t('versions.columns.type')}</th>
          <th className="py-1 pr-3 font-medium">{t('versions.columns.id')}</th>
          <th className="py-1 pr-3 font-medium">{t('versions.columns.label')}</th>
          <th className="py-1 pr-3 font-medium">{t('versions.columns.diff')}</th>
          {onRemove && <th className="py-1 font-medium" />}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={`${r.repoPath}\u0000${r.versionId}\u0000${r.id}`} className="border-b border-edge-subtle" data-testid={`version-change-${r.id}`}>
            <td className="py-1 pr-3 text-ink-2">{r.componentLabel}</td>
            <td className="py-1 pr-3 text-ink-2">{r.versionTitle} <span className="text-ink-3">({r.versionId})</span></td>
            <td className="py-1 pr-3 text-ink-2">{r.category ? t(`versions.category.${r.category}`) : <span className="italic text-ink-3">{t('versions.page.deleted')}</span>}</td>
            <td className="py-1 pr-3">
              {r.category ? <button type="button" onClick={() => openElement(r)} className="text-prim hover:underline font-mono">{r.id}</button> : <span className="font-mono text-ink-3">{r.id}</span>}
            </td>
            <td className="py-1 pr-3 text-ink">{r.title}{!r.base && r.category && <span className="ml-2 text-[10px] text-status-info">{t('versions.backlog.kind.new')}</span>}</td>
            <td className="py-1 pr-3">
              {r.filePath && (
                <button type="button" onClick={() => openDiff(r)} className="inline-flex items-center gap-1 text-prim hover:underline" data-testid={`version-diff-${r.id}`}>
                  <FileDiff size={12} />{t('versions.seeChanges')}
                </button>
              )}
            </td>
            {onRemove && (
              <td className="py-1 text-right">
                {r.own && (
                  <button type="button" onClick={() => onRemove(r.id)} className="btn-icon text-ink-3 hover:text-status-danger" title={t('versions.page.remove')} data-testid={`version-remove-${r.id}`}>
                    <X size={12} />
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
