import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminMe } from '@polenta/types'
import { adminApi, type ExportRow } from '../../lib/adminApi'
import { ConfirmByName } from './ConfirmByName'
import { JobView } from './JobView'
import { useLaunch } from './useLaunch'

const size = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} Go` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} Mo` : `${Math.ceil(b / 1024)} Ko`)

/** GH63 — exports de restitution : création, téléchargement en flux, suppression (confirmation simple). */
export function ExportsPanel({ me, instances }: { me: AdminMe; instances: string[] }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ExportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [instance, setInstance] = useState(me.instance)
  const [toDelete, setToDelete] = useState<ExportRow | null>(null)
  const { jobId, error: launchError, launch, clear } = useLaunch()

  const reload = useCallback(() => {
    adminApi.exports().then(setRows, e => setError(String(e.message ?? e)))
  }, [])
  useEffect(reload, [reload])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {me.level === 'host' && (
          <label className="text-sm text-ink">
            {t('admin.backups.instance')}
            <select className="input-field mt-1 block" value={instance} onChange={e => setInstance(e.target.value)}>
              {instances.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn-primary" onClick={() => void launch({ operation: 'export.run', instance })}>{t('admin.exports.run')}</button>
      </div>
      <p className="text-xs text-ink-3">{t('admin.exports.hint')}</p>
      {jobId && <JobView jobId={jobId} onEnd={reload} onClose={clear} />}
      {(launchError || error) && <p className="text-sm text-status-danger" role="alert">{launchError ?? error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-ink-3">{t('admin.exports.none')}</p>}
      {rows && rows.length > 0 && (
        <table className="w-full text-sm" data-testid="admin-exports">
          <thead>
            <tr className="text-left text-xs text-ink-3 border-b border-edge">
              <th className="py-2 pr-3">{t('admin.exports.file')}</th>
              <th className="py-2 pr-3">{t('admin.exports.size')}</th>
              <th className="py-2 pr-3">SHA-256</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.file} className="border-b border-edge">
                <td className="py-1.5 pr-3 font-mono text-xs">{r.file}</td>
                <td className="py-1.5 pr-3 text-xs">{size(r.sizeBytes)}</td>
                <td className="py-1.5 pr-3 font-mono text-xs" title={r.sha256}>{r.sha256?.slice(0, 12) ?? '—'}</td>
                <td className="py-1.5 text-right space-x-1.5 whitespace-nowrap">
                  <a className="btn-secondary-sm inline-block" href={adminApi.exportDownloadUrl(r.file)} download={r.file}>{t('admin.exports.download')}</a>
                  <button type="button" className="btn-danger-sm" onClick={() => setToDelete(r)}>{t('common.delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {toDelete && (
        <ConfirmByName
          title={t('admin.exports.deleteTitle', { file: toDelete.file })}
          message={t('admin.exports.deleteMessage')}
          danger
          confirmLabel={t('common.delete')}
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            const row = toDelete
            setToDelete(null)
            void launch({ operation: 'export.delete', instance: row.instance, params: { file: row.file }, confirm: true })
          }}
        />
      )}
    </div>
  )
}
