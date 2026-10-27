import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import type { DrawioPage } from '@polenta/api-client'
import { api } from '../../api'
import { alignByKey, pageKeys } from '../../lib/align'
import { renderStaticDrawio } from '../../lib/staticDrawio'

export interface DrawioSide {
  /** Version git du fichier, `null` = working tree. */
  at: string | null
  /** Fichier absent de cette version. */
  missing: boolean
  label: string
}

/**
 * GH178 — mode Rendu d'un fichier `.drawio` : chaque colonne rend ses pages à sa version, alignées
 * par nom de page (par id quand un nom est en double). Page modifiée = XML différent ; diff au
 * niveau de la page, pas des formes.
 */
export function DrawioFileDiffView({ repoPath, filepath, before, after, hideUnchanged }: {
  repoPath: string
  filepath: string
  before: DrawioSide
  after: DrawioSide
  hideUnchanged: boolean
}) {
  const { t } = useTranslation()
  const read = (side: DrawioSide) => ({
    queryKey: ['diff-drawio-file', repoPath, filepath, side.at],
    queryFn: async () => (await api.drawio.read(repoPath, filepath, side.at)) ?? null,
    enabled: !!repoPath && !side.missing,
    staleTime: side.at ? Infinity : 0,
  })
  const beforePages = useQuery<DrawioPage[] | null>(read(before))
  const afterPages = useQuery<DrawioPage[] | null>(read(after))
  // Expanded folds, by page key: stable when the working-tree side is re-read and rows shift.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const rows = useMemo(() => {
    const a = before.missing ? [] : beforePages.data ?? []
    const b = after.missing ? [] : afterPages.data ?? []
    const [ka, kb] = pageKeys(a, b)
    return alignByKey(ka, kb).map(([i, j]) => {
      const pa = i === null ? undefined : a[i]
      const pb = j === null ? undefined : b[j]
      return { pa, pb, key: j === null ? ka[i!] : kb[j], changed: !pa || !pb || pa.xml !== pb.xml }
    })
  }, [before.missing, after.missing, beforePages.data, afterPages.data])

  if (beforePages.isLoading || afterPages.isLoading) return <p className="text-ink-3 italic p-6">{t('common.loading')}</p>

  // Folding of consecutive unchanged pages, as for object units.
  const display: Array<{ row: typeof rows[number] } | { folded: string[] }> = []
  for (const row of rows) {
    const last = display[display.length - 1]
    if (hideUnchanged && !row.changed && !expanded.has(row.key)) {
      if (last && 'folded' in last) last.folded.push(row.key)
      else display.push({ folded: [row.key] })
    } else display.push({ row })
  }

  const unreadable = (side: DrawioSide, q: typeof beforePages) => !side.missing && !q.isLoading && !q.data?.length

  const cell = (side: 'before' | 'after', page: DrawioPage | undefined, changed: boolean) => {
    const s = side === 'before' ? before : after
    const tone = !changed ? '' : side === 'before'
      ? 'bg-status-danger-bg dark:bg-status-danger-bg/15'
      : 'bg-status-success-bg dark:bg-status-success-bg/15'
    return (
      <div className={`px-3 py-2 min-w-0 overflow-auto ${side === 'after' ? 'border-l border-edge' : ''} ${tone}`}>
        {page
          ? <DrawioPageView repoPath={repoPath} filepath={filepath} pageId={page.id} at={s.at}
              frame={changed ? (side === 'before' ? 'diff-media-del' : 'diff-media-ins') : undefined} />
          : !s.missing && <p className="text-xs text-ink-3 italic">{t('diffView.absentPage')}</p>}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto" data-testid="drawio-diff">
      <div className="grid grid-cols-2 min-w-0">
        <Title>{before.label}</Title>
        <Title border>{after.label}</Title>
        {[before, after].some((s, k) => s.missing || unreadable(s, k === 0 ? beforePages : afterPages)) && (
          <>
            <Notice side={before} unreadable={unreadable(before, beforePages)} />
            <Notice side={after} unreadable={unreadable(after, afterPages)} border />
          </>
        )}
        {display.map(d => 'row' in d ? (
          <Fragment key={d.row.key}>
            <div data-page={(d.row.pb ?? d.row.pa)!.name} data-changed={d.row.changed || undefined}
              className="col-span-2 px-3 pt-2 text-[11px] uppercase tracking-wide text-ink-3 border-t border-edge-subtle">
              {t('diffView.page', { name: (d.row.pb ?? d.row.pa)!.name })}
            </div>
            {cell('before', d.row.pa, d.row.changed)}
            {cell('after', d.row.pb, d.row.changed)}
          </Fragment>
        ) : (
          <button key={`fold-${d.folded[0]}`} type="button"
            className="col-span-2 px-3 py-1 text-xs text-ink-3 hover:bg-surface-hover border-t border-edge-subtle flex items-center gap-1 text-left"
            onClick={() => setExpanded(prev => new Set([...prev, ...d.folded]))}>
            <ChevronRight size={12} />
            {t('diffView.unchangedPages', { count: d.folded.length })}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Une page rendue par le viewer statique (même rendu que les diagrammes de la Vue Word). */
function DrawioPageView({ repoPath, filepath, pageId, at, frame }: {
  repoPath: string; filepath: string; pageId: string; at: string | null; frame?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return renderStaticDrawio(el, repoPath, undefined, at)
  }, [repoPath, filepath, pageId, at])
  return (
    <span ref={ref} className={`static-drawio inline-block my-1 align-top ${frame ?? ''}`}
      data-drawio-path={filepath} data-drawio-node-id={pageId} />
  )
}

function Title({ children, border }: { children: string; border?: boolean }) {
  return (
    <div className={`sticky top-0 z-10 px-3 py-1 bg-canvas border-b border-edge text-[11px] uppercase tracking-wide text-ink-3 truncate ${border ? 'border-l' : ''}`}>
      {children}
    </div>
  )
}

function Notice({ side, unreadable, border }: { side: DrawioSide; unreadable: boolean; border?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={`px-3 py-2 ${border ? 'border-l border-edge' : ''}`}>
      {side.missing && <p className="text-xs text-ink-3 italic">{t('diffView.absentFile')}</p>}
      {unreadable && <p className="text-xs text-status-warning">{t('diffView.renderUnavailable')}</p>}
    </div>
  )
}
