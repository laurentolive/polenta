import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditLine } from '@polenta/types'
import { adminApi } from '../../lib/adminApi'

/** GH63 — journal d'audit (filtré à l'instance au niveau instance par le service) et export CSV. */
export function JournalPanel() {
  const { t } = useTranslation()
  const [lines, setLines] = useState<AuditLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState('')

  useEffect(() => {
    setLines(null)
    adminApi.audit(from ? { from: new Date(from).toISOString() } : {}).then(l => setLines(l.slice().reverse()), e => setError(String(e.message ?? e)))
  }, [from])

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <label className="text-sm text-ink">
          {t('admin.journal.from')}
          <input type="date" className="input-field mt-1 block" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <a className="btn-secondary" href={adminApi.auditCsvUrl(from ? { from: new Date(from).toISOString() } : {})} download="audit.csv">
          {t('admin.journal.exportCsv')}
        </a>
      </div>
      {error && <p className="text-sm text-status-danger" role="alert">{error}</p>}
      {lines && lines.length === 0 && <p className="text-sm text-ink-3">{t('admin.journal.empty')}</p>}
      {lines && lines.length > 0 && (
        <table className="w-full text-xs" data-testid="admin-audit">
          <thead>
            <tr className="text-left text-ink-3 border-b border-edge">
              <th className="py-2 pr-3">{t('admin.journal.when')}</th>
              <th className="py-2 pr-3">{t('admin.journal.who')}</th>
              <th className="py-2 pr-3">{t('admin.journal.operation')}</th>
              <th className="py-2 pr-3">{t('admin.journal.target')}</th>
              <th className="py-2">{t('admin.journal.result')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.ts}-${i}`} className="border-b border-edge">
                <td className="py-1 pr-3 whitespace-nowrap">{new Date(l.ts).toLocaleString()}</td>
                <td className="py-1 pr-3">{l.actor}<span className="text-ink-3"> · {l.actorInstance} · {l.origin}</span></td>
                <td className="py-1 pr-3 font-mono">{l.operation}</td>
                <td className="py-1 pr-3 font-mono">{l.target}</td>
                <td className={`py-1 ${l.result === 'refused' || l.result === 'failed' ? 'text-status-danger' : l.result === 'succeeded' ? 'text-status-success' : 'text-ink-2'}`}>
                  {t(`admin.audit.${l.result}`, { defaultValue: l.result })}{l.reason ? ` (${l.reason})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
