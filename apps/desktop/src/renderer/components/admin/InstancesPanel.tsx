import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminMe, JobCreate } from '@polenta/types'
import { adminApi, type InstanceRow } from '../../lib/adminApi'
import { ConfirmByName } from './ConfirmByName'
import { JobView } from './JobView'
import { useLaunch } from './useLaunch'
import { useUpdateState } from '../../hooks/useUpdateState'
import { platform } from '../../platform'
import { isNewer } from '../../../shared/version-compare'

type Pending = { job: JobCreate; title: string; message: string; expected?: string; danger?: boolean; confirmLabel: string } | null

/** GH63 — instances : état, démarrage/arrêt, remise à niveau, sauvegarde, mise à jour de la forge, client web. */
export function InstancesPanel({ me }: { me: AdminMe }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<InstanceRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [webVersions, setWebVersions] = useState<Record<string, string>>({})
  const { jobId, error, launch, clear } = useLaunch()
  const update = useUpdateState()
  // GH305 — release détectée par le serveur web (W2), proposée seulement si elle est plus récente
  // que le client web de l'instance (jamais un retour en arrière suggéré). Client web uniquement :
  // sur le desktop, l'état de mise à jour est celui de l'installeur, pas du serveur.
  const release = platform === 'web' && update?.status === 'available' ? update.availableVersion : undefined
  const webVersionOf = (r: InstanceRow) =>
    webVersions[r.name] ?? (release && (!r.webVersion || isNewer(release, r.webVersion)) ? release : '')

  const reload = useCallback(() => {
    adminApi.instances().then(setRows, e => setLoadError(String(e.message ?? e)))
  }, [])
  useEffect(reload, [reload])

  const host = me.level === 'host'
  const self = (name: string) => name === me.instance

  function ask(p: NonNullable<Pending>) {
    setPending(p)
  }

  return (
    <div className="space-y-4">
      {jobId && <JobView jobId={jobId} onEnd={reload} onClose={clear} />}
      {error && <p className="text-sm text-status-danger" role="alert">{error}</p>}
      {loadError && <p className="text-sm text-status-danger" role="alert">{loadError}</p>}
      {!rows && !loadError && <p className="text-sm text-ink-3">{t('common.loading')}</p>}
      {rows && (
        <table className="w-full text-sm" data-testid="admin-instances">
          <thead>
            <tr className="text-left text-xs text-ink-3 border-b border-edge">
              <th className="py-2 pr-3">{t('admin.instances.name')}</th>
              <th className="py-2 pr-3">{t('admin.instances.domain')}</th>
              <th className="py-2 pr-3">{t('admin.instances.version')}</th>
              <th className="py-2 pr-3">{t('admin.instances.state')}</th>
              <th className="py-2 pr-3">{t('admin.instances.lastBackup')}</th>
              <th className="py-2">{t('admin.instances.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name} className="border-b border-edge align-top">
                <td className="py-2 pr-3 font-mono">{r.name}{self(r.name) && <span className="ml-1 text-xs text-ink-3">({t('admin.instances.current')})</span>}</td>
                <td className="py-2 pr-3">{r.domain}{r.webDomain && <div className="text-xs text-ink-3">{r.webDomain}</div>}</td>
                <td className="py-2 pr-3 font-mono">{r.forgeVersion}{r.webDomain && r.webVersion && <div className="text-xs text-ink-3">{t('admin.instances.webVersion', { version: r.webVersion })}</div>}</td>
                <td className="py-2 pr-3">{r.state}</td>
                <td className="py-2 pr-3 text-xs">{r.lastBackup ?? '—'}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn-secondary-sm" onClick={() => void launch({ operation: 'backup.run', instance: r.name })}>{t('admin.instances.backup')}</button>
                    <button type="button" className="btn-secondary-sm" onClick={() => void launch({ operation: 'instance.sync', instance: r.name })}>{t('admin.instances.sync')}</button>
                    <button type="button" className="btn-secondary-sm" onClick={() => void launch({ operation: 'instance.start', instance: r.name })}>{t('admin.instances.start')}</button>
                    {/* Arrêt et désactivation du client web depuis ce même client : refusés par le service (code 18), non proposés. */}
                    {!self(r.name) && (
                      <button type="button" className="btn-secondary-sm" onClick={() => ask({ job: { operation: 'instance.stop', instance: r.name }, title: t('admin.instances.stopTitle', { name: r.name }), message: t('admin.instances.stopMessage'), confirmLabel: t('admin.instances.stop') })}>
                        {t('admin.instances.stop')}
                      </button>
                    )}
                    {r.webDomain && !self(r.name) && (
                      <button type="button" className="btn-secondary-sm" onClick={() => void launch({ operation: 'web.disable', instance: r.name })}>{t('admin.instances.webDisable')}</button>
                    )}
                    {host && !self(r.name) && (
                      <button type="button" className="btn-danger-sm" onClick={() => ask({ job: { operation: 'instance.remove', instance: r.name }, title: t('admin.instances.removeTitle', { name: r.name }), message: t('admin.instances.removeMessage'), expected: r.name, danger: true, confirmLabel: t('admin.instances.remove') })}>
                        {t('admin.instances.remove')}
                      </button>
                    )}
                  </div>
                  <form
                    className="flex gap-1.5 mt-1.5"
                    onSubmit={e => {
                      e.preventDefault()
                      const version = versions[r.name]?.trim()
                      if (!version) return
                      ask({
                        job: { operation: 'forge.update', instance: r.name, params: { version } },
                        title: t('admin.instances.updateTitle', { name: r.name, version }),
                        message: self(r.name) ? t('admin.instances.updateSelfWarning') : t('admin.instances.updateMessage'),
                        confirmLabel: t('admin.instances.update'),
                      })
                    }}
                  >
                    <input
                      className="input-field text-xs py-1 w-28 font-mono"
                      placeholder="11.0.3"
                      aria-label={t('admin.instances.versionInput', { name: r.name })}
                      value={versions[r.name] ?? ''}
                      onChange={e => setVersions(v => ({ ...v, [r.name]: e.target.value }))}
                    />
                    <button type="submit" className="btn-secondary-sm">{t('admin.instances.update')}</button>
                  </form>
                  {r.webDomain && (
                    // GH305 — client web : version libre, préremplie avec la release détectée (W2).
                    <form
                      className="flex items-center gap-1.5 mt-1.5"
                      onSubmit={e => {
                        e.preventDefault()
                        const version = webVersionOf(r).trim()
                        if (!version) return
                        ask({
                          job: { operation: 'web.update', instance: r.name, params: { version } },
                          title: t('admin.instances.webUpdateTitle', { name: r.name, version }),
                          message: self(r.name) ? t('admin.instances.webUpdateSelfWarning') : t('admin.instances.webUpdateMessage'),
                          confirmLabel: t('admin.instances.update'),
                        })
                      }}
                    >
                      <input
                        className="input-field text-xs py-1 w-28 font-mono"
                        placeholder={r.webVersion ?? 'X.Y.Z'}
                        aria-label={t('admin.instances.webVersionInput', { name: r.name })}
                        value={webVersionOf(r)}
                        onChange={e => setWebVersions(v => ({ ...v, [r.name]: e.target.value }))}
                      />
                      <button type="submit" className="btn-secondary-sm">{t('admin.instances.webUpdate')}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pending && (
        <ConfirmByName
          title={pending.title}
          message={pending.message}
          expected={pending.expected}
          danger={pending.danger}
          confirmLabel={pending.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={typed => {
            const job = { ...pending.job, confirm: typed }
            setPending(null)
            void launch(job)
          }}
        />
      )}
    </div>
  )
}
