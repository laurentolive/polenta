import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminMe } from '@polenta/types'
import { adminApi, type Snapshot } from '../../lib/adminApi'
import { ConfirmByName } from './ConfirmByName'
import { JobView } from './JobView'
import { useLaunch } from './useLaunch'

/** GH63 — sauvegardes d'une instance : liste des instantanés, sauvegarde manuelle étiquetée. */
export function BackupsPanel({ me, instances }: { me: AdminMe; instances: string[] }) {
  const { t } = useTranslation()
  const [instance, setInstance] = useState(me.instance)
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tag, setTag] = useState('')
  const [confirm, setConfirm] = useState<{ kind: 'restore'; snapshot: string } | { kind: 'keys' } | null>(null)
  const { jobId, error: launchError, launch, clear } = useLaunch()

  const reload = useCallback(() => {
    setSnapshots(null)
    setError(null)
    adminApi.backups(instance).then(r => setSnapshots(r.snapshots), e => setError(String(e.message ?? e)))
  }, [instance])
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
        <form
          className="flex items-end gap-2"
          onSubmit={e => {
            e.preventDefault()
            void launch({ operation: 'backup.run', instance, params: tag.trim() ? { tag: tag.trim() } : {} })
          }}
        >
          <label className="text-sm text-ink">
            {t('admin.backups.tag')}
            <input className="input-field mt-1 block w-48 font-mono" placeholder="manual" value={tag} onChange={e => setTag(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary">{t('admin.backups.run')}</button>
        </form>
        {me.level === 'host' && (
          <button type="button" className="btn-secondary" onClick={() => setConfirm({ kind: 'keys' })}>{t('admin.backups.showKey')}</button>
        )}
      </div>
      {jobId && <JobView jobId={jobId} onEnd={reload} onClose={clear} />}
      {launchError && <p className="text-sm text-status-danger" role="alert">{launchError}</p>}
      {error && <p className="text-sm text-status-danger" role="alert">{error}</p>}
      {snapshots && snapshots.length === 0 && <p className="text-sm text-ink-3">{t('admin.backups.none')}</p>}
      {snapshots && snapshots.length > 0 && (
        <table className="w-full text-sm" data-testid="admin-snapshots">
          <thead>
            <tr className="text-left text-xs text-ink-3 border-b border-edge">
              <th className="py-2 pr-3">{t('admin.backups.id')}</th>
              <th className="py-2 pr-3">{t('admin.backups.time')}</th>
              <th className="py-2 pr-3">{t('admin.backups.tags')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {snapshots.map(s => (
              <tr key={s.id} className="border-b border-edge">
                <td className="py-1.5 pr-3 font-mono text-xs">{String(s.id).slice(0, 8)}</td>
                <td className="py-1.5 pr-3 text-xs">{s.time ? new Date(s.time).toLocaleString() : '—'}</td>
                <td className="py-1.5 pr-3 text-xs">{(s.tags ?? []).join(', ')}</td>
                <td className="py-1.5 text-right">
                  <button type="button" className="btn-secondary-sm" onClick={() => setConfirm({ kind: 'restore', snapshot: String(s.id) })}>{t('admin.backups.restore')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirm?.kind === 'restore' && (
        <ConfirmByName
          title={t('admin.backups.restoreTitle', { name: instance, snapshot: confirm.snapshot.slice(0, 8) })}
          message={t('admin.backups.restoreMessage')}
          expected={instance}
          danger
          confirmLabel={t('admin.backups.restore')}
          onCancel={() => setConfirm(null)}
          onConfirm={typed => {
            const snapshot = confirm.snapshot
            setConfirm(null)
            void launch({ operation: 'backup.restore', instance, params: { from: snapshot }, confirm: typed })
          }}
        />
      )}
      {confirm?.kind === 'keys' && (
        <ConfirmByName
          title={t('admin.backups.keyTitle', { name: instance })}
          message={t('admin.backups.keyMessage')}
          expected={instance}
          confirmLabel={t('admin.backups.showKey')}
          onCancel={() => setConfirm(null)}
          onConfirm={typed => {
            setConfirm(null)
            void launch({ operation: 'backup.keys', instance, confirm: typed })
          }}
        />
      )}
    </div>
  )
}
