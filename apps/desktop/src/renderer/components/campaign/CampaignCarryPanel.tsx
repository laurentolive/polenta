import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TestCampaign, TestCase, TestRunStatus } from '@polenta/types'
import { CARRY_STATUSES, versionChanged, type CarryRow } from '../../lib/carryOver'
import { RUN_CLASS, STATUS_CLASS as CAMPAIGN_STATUS_CLASS } from '../system/CampaignListView'

/**
 * GH64 — onglet « Depuis une campagne » du sélecteur de tests : campagnes source, filtre par statut
 * d'entrée, entrées proposées (cochées / grisées avec leur motif). Composant contrôlé : l'état (et
 * le calcul des lignes, qui dépend de la résolution des paramètres) vit dans `TestPickerModal`.
 */
export function CampaignCarryPanel({
  campaigns,
  isLoading,
  sources,
  onSourcesChange,
  statuses,
  onStatusesChange,
  rows,
  checked,
  onCheckedChange,
  testsById,
}: {
  /** Campagnes proposées (sans la cible), plus récente d'abord. */
  campaigns: TestCampaign[]
  isLoading: boolean
  sources: Set<string>
  onSourcesChange: (next: Set<string>) => void
  statuses: Set<TestRunStatus>
  onStatusesChange: (next: Set<TestRunStatus>) => void
  rows: CarryRow[]
  checked: Set<string>
  onCheckedChange: (next: Set<string>) => void
  testsById: Map<string, TestCase>
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      [r.testCaseId, testsById.get(r.testCaseId)?.title ?? '', r.requirementId ?? '', r.campaignId]
        .some(v => v.toLowerCase().includes(q)))
  }, [rows, filter, testsById])
  const available = shown.filter(r => !r.unavailable)
  const allChecked = available.length > 0 && available.every(r => checked.has(r.key))

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  function toggleAll() {
    const next = new Set(checked)
    for (const r of available) {
      if (allChecked) next.delete(r.key)
      else next.add(r.key)
    }
    onCheckedChange(next)
  }

  function remark(r: CarryRow): string {
    const parts: string[] = []
    if (r.unavailable) parts.push(t(`campaignPage.carry.unavailable.${r.unavailable}`))
    if (versionChanged(r)) parts.push(t('campaignPage.carry.versionChanged', { from: r.sourceVersion, to: r.liveVersion }))
    if (r.otherSources.length > 0) parts.push(t('campaignPage.carry.alsoIn', { ids: r.otherSources.join(', ') }))
    return parts.join(' · ')
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Campagnes source */}
      <div className="w-72 shrink-0 border-r border-edge flex flex-col min-h-0">
        <p className="px-3 py-2 text-xs font-medium text-ink-2 border-b border-edge">{t('campaignPage.carry.sources')}</p>
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-edge" data-testid="carry-sources">
          {isLoading ? (
            <p className="p-3 text-xs text-ink-3 italic">{t('common.loading')}</p>
          ) : campaigns.length === 0 ? (
            <p className="p-3 text-xs text-ink-3 italic">{t('campaignPage.carry.noCampaign')}</p>
          ) : campaigns.map(c => (
            <label key={c.id} className="flex items-start gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-hover/50">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={sources.has(c.id)}
                onChange={() => onSourcesChange(toggle(sources, c.id))}
                aria-label={c.id}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-ink-3">{c.id}</span>
                  <span className={`px-1.5 rounded-full text-[10px] ${CAMPAIGN_STATUS_CLASS[c.status] ?? ''}`}>
                    {t(`campaignPage.carry.campaignStatus.${c.status}`)}
                  </span>
                </span>
                <span className="block text-ink truncate">{c.title}</span>
                <span className="block text-[10px] text-ink-3">
                  {[c.createdAt.slice(0, 10), c.baselineRef, c.component, c.level].filter(Boolean).join(' · ')}
                </span>
                {c.runs.length > 0 && (
                  <span className="flex gap-1 mt-0.5 text-[10px]">
                    {CARRY_STATUSES.map(s => {
                      const n = c.runs.filter(r => r.status === s).length
                      return n ? <span key={s} className={`px-1.5 rounded-full ${RUN_CLASS[s] ?? ''}`}>{n}</span> : null
                    })}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Entrées */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-edge">
          <span className="text-xs text-ink-2">{t('campaignPage.carry.statusFilter')}</span>
          {CARRY_STATUSES.map(s => (
            <label key={s} className="flex items-center gap-1 text-xs text-ink-2">
              <input type="checkbox" checked={statuses.has(s)} onChange={() => onStatusesChange(toggle(statuses, s))} />
              {t(`campaignPage.runStatus.${s.toLowerCase()}`)}
            </label>
          ))}
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('common.filterPlaceholder')}
            className="input-field text-xs flex-1 min-w-[10rem]"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {shown.length === 0 ? (
            <p className="p-4 text-xs text-ink-3 italic">
              {sources.size === 0 ? t('campaignPage.carry.pickSource') : t('campaignPage.carry.noEntry')}
            </p>
          ) : (
            <table className="w-full text-xs" data-testid="carry-rows">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-ink-3 border-b border-edge">
                  <th className="px-3 py-1.5 w-8">
                    <input type="checkbox" checked={allChecked} disabled={available.length === 0} onChange={toggleAll} aria-label={t('campaignPage.carry.checkAll')} />
                  </th>
                  <th className="px-2 py-1.5 font-medium">{t('campaignPage.carry.colTest')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('campaignPage.carry.colRequirement')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('campaignPage.carry.colParams')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('campaignPage.carry.colStatus')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('campaignPage.carry.colExecution')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('campaignPage.carry.colSource')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('campaignPage.carry.colRemark')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {shown.map(r => {
                  const values = Object.entries(r.paramValues).filter(([, v]) => v.trim())
                  return (
                    <tr key={r.key} className={r.unavailable ? 'opacity-50' : 'hover:bg-hover/50'} data-entry={`${r.campaignId}/${r.entryId}`}>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          disabled={!!r.unavailable}
                          checked={!r.unavailable && checked.has(r.key)}
                          onChange={() => onCheckedChange(toggle(checked, r.key))}
                          aria-label={`${r.campaignId}/${r.entryId}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 max-w-[18rem]">
                        <span className="font-mono text-ink-3">{r.testCaseId}</span>
                        <span className="ml-2 text-ink truncate">{testsById.get(r.testCaseId)?.title ?? ''}</span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-ink-3">{r.requirementId ?? ''}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-ink-3 max-w-[12rem] truncate">
                        {values.map(([k, v]) => `${k}=${v}`).join(', ')}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${RUN_CLASS[r.status] ?? ''}`}>{t(`campaignPage.runStatus.${r.status.toLowerCase()}`)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-ink-3 whitespace-nowrap">
                        {[r.executedAt?.slice(0, 10), r.executedBy].filter(Boolean).join(' · ')}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-ink-3">{r.campaignId}</td>
                      <td className={`px-2 py-1.5 text-[10px] ${r.unavailable ? 'text-ink-3' : 'text-status-warning'}`}>{remark(r)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
