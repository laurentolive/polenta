import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ObjectHistory, ObjectTypeDefinition } from '@polenta/types'
import { api } from '../../api'
import { historySections, type HistoryBadge } from './historySections'

interface Props {
  repoPath: string
  kind: 'requirement' | 'test' | 'campaign' | 'change'
  id: string
  typeDef?: Pick<ObjectTypeDefinition, 'fields' | 'statuses'> | null
  /** Libellé d'un statut quand il ne vient pas du schéma (campagnes : statuts fixes). */
  statusLabel?: (name: string) => string
  /** Change à chaque écriture de l'objet (ex. son `history` sérialisé) : relit l'historique effectif. */
  refreshKey?: string
  /** GH199 — cadre des autres sections repliables (page d'un changeset). */
  framed?: boolean
}

const BADGE_CLASS: Record<HistoryBadge, string> = {
  mcp: 'bg-status-info-bg text-status-info',
  git: 'bg-status-neutral-bg text-status-neutral',
  schema: 'bg-status-neutral-bg text-status-neutral',
  implicit: 'bg-status-warning-bg text-status-warning',
}

/**
 * GH77 — historique des champs suivis d'un objet, en lecture seule (spec §10) : données brutes,
 * aucune durée ni synthèse (les indicateurs vivent côté projet, #74/#79). Repliée par défaut,
 * chargée à l'ouverture (`history:get`, entrées déduites comprises).
 */
export function HistorySection({ repoPath, kind, id, typeDef, statusLabel, refreshKey, framed }: Props) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: history, isLoading, error } = useQuery<ObjectHistory>({
    queryKey: ['history', repoPath, kind, id, refreshKey ?? ''],
    queryFn: () => api.history.get(repoPath, kind, id),
    enabled: open && !!repoPath && !!id,
  })
  // GH199 — acquittements de l'ancien flux d'impact élément unique, lus seulement s'il en existe.
  const { data: legacyAcks = [] } = useQuery({
    queryKey: ['legacy-acks', repoPath, id],
    queryFn: () => api.traceability.legacyAcks(repoPath, id),
    enabled: open && !!repoPath && !!id && (kind === 'requirement' || kind === 'test'),
  })
  const sections = history ? historySections(history, typeDef, { status: t('history.status'), statusLabel }) : []
  const date = (at: string) => {
    const d = new Date(at)
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString(i18n.language)
  }

  return (
    <section className={framed ? 'border rounded p-3 mb-4' : 'border-t border-edge pt-3 mt-2'} data-testid="history-section">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-semibold text-ink-2 uppercase tracking-wide hover:text-ink"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {t('history.title')}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {isLoading && <p className="text-xs text-ink-3">{t('common.loading')}</p>}
          {error && <p className="text-xs text-status-danger">{error instanceof Error ? error.message : String(error)}</p>}
          {history && sections.length === 0 && <p className="text-xs text-ink-3 italic">{t('history.empty')}</p>}
          {sections.map(section => (
            <div key={section.key}>
              <p className="text-xs font-medium text-ink mb-1">{section.label}</p>
              <ul className="space-y-0.5">
                {section.rows.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-xs text-ink-2">
                    <span className="text-ink-3 tabular-nums shrink-0">{date(r.at)}</span>
                    <span className="text-ink">
                      {r.value === undefined ? t('history.modified') : r.value === null ? t('history.emptyValue') : r.value}
                    </span>
                    {r.by && <span className="text-ink-3">{r.by}</span>}
                    {r.badges.map(b => (
                      <span key={b} className={`rounded px-1 text-[10px] ${BADGE_CLASS[b]}`} title={t(`history.badgeTitle.${b}`)}>
                        {t(`history.badge.${b}`)}
                      </span>
                    ))}
                    {r.comment && <span className="text-ink-2 italic" data-testid="history-comment">« {r.comment} »</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {legacyAcks.length > 0 && (
            <details data-testid="history-legacy-acks">
              <summary className="text-xs font-medium text-ink cursor-pointer">{t('history.legacyAcks', { count: legacyAcks.length })}</summary>
              <ul className="mt-1 space-y-0.5">
                {legacyAcks.map(a => (
                  <li key={a.id} className="flex items-baseline gap-2 text-xs text-ink-2">
                    <span className="text-ink-3 tabular-nums shrink-0">{date(a.acknowledgedAt)}</span>
                    <span className="font-mono">{a.triggerReqId}</span>
                    {a.acknowledgedBy && <span className="text-ink-3">{a.acknowledgedBy}</span>}
                    {a.comment && <span className="italic">« {a.comment} »</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
