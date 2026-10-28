import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminMe, HostModuleName } from '@polenta/types'
import { ConfirmByName } from './ConfirmByName'
import { JobView } from './JobView'
import { useLaunch } from './useLaunch'

const MODULES: HostModuleName[] = ['docker', 'firewall', 'fail2ban', 'fail2ban-forge', 'unattended', 'ssh-hardening', 'backup-cron']

/**
 * GH63 — hôte (niveau hôte seulement) : modules actifs (#62), fail2ban, pare-feu, remise à niveau,
 * redémarrage. Actions grisées si l'agent est absent ou le module inactif (rien n'est installé ici).
 */
export function HostPanel({ me }: { me: AdminMe }) {
  const { t } = useTranslation()
  const [ip, setIp] = useState('')
  const [confirm, setConfirm] = useState<'setup' | 'reboot' | null>(null)
  const [sshConfirmed, setSshConfirmed] = useState(false)
  const { jobId, error, launch, clear } = useLaunch()
  const agentUp = me.agent === 'up'
  const why = (module?: HostModuleName) =>
    !agentUp ? t('admin.host.agentAbsent') : module && !me.modules[module] ? t('admin.host.moduleAbsent', { module }) : undefined

  const fail2banOff = why('fail2ban')
  const firewallOff = why('firewall')
  const agentOff = why()

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('admin.host.state')}</h3>
        <p className="text-sm">
          {t('admin.host.agent')} :{' '}
          <span className={agentUp ? 'text-status-success' : 'text-status-warning'} data-testid="admin-agent-state">{t(`admin.host.agent_${me.agent}`)}</span>
          {' · '}{t('admin.host.caddy')} : {me.caddyMode}
        </p>
        <ul className="flex flex-wrap gap-2 text-xs" aria-label={t('admin.host.modules')}>
          {MODULES.map(m => (
            <li key={m} className={`px-2 py-0.5 rounded border border-edge ${me.modules[m] ? 'text-ink' : 'text-ink-3 line-through'}`}>{m}</li>
          ))}
        </ul>
      </section>

      {jobId && <JobView jobId={jobId} onClose={clear} />}
      {error && <p className="text-sm text-status-danger" role="alert">{error}</p>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">fail2ban</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className="btn-secondary-sm" disabled={!!fail2banOff} title={fail2banOff} onClick={() => void launch({ operation: 'fail2ban.status' })}>
            {t('admin.host.fail2banStatus')}
          </button>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (ip.trim()) void launch({ operation: 'fail2ban.unban', params: { ip: ip.trim() } }) }}>
            <input className="input-field text-xs py-1 w-44 font-mono" placeholder="203.0.113.9" aria-label={t('admin.host.ip')} value={ip} onChange={e => setIp(e.target.value)} disabled={!!fail2banOff} />
            <button type="submit" className="btn-secondary-sm" disabled={!!fail2banOff} title={fail2banOff}>{t('admin.host.unban')}</button>
          </form>
        </div>
        {fail2banOff && <p className="text-xs text-ink-3">{fail2banOff}</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('admin.host.firewall')}</h3>
        <button type="button" className="btn-secondary-sm" disabled={!!firewallOff} title={firewallOff} onClick={() => void launch({ operation: 'firewall.status' })}>
          {t('admin.host.firewallStatus')}
        </button>
        {firewallOff && <p className="text-xs text-ink-3">{firewallOff}</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('admin.host.maintenance')}</h3>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={!!agentOff} title={agentOff} onClick={() => setConfirm('setup')}>{t('admin.host.setup')}</button>
          <button type="button" className="btn-danger" disabled={!!agentOff} title={agentOff} onClick={() => setConfirm('reboot')}>{t('admin.host.reboot')}</button>
        </div>
        {agentOff && <p className="text-xs text-ink-3">{agentOff}</p>}
      </section>

      {confirm === 'setup' && (
        <ConfirmByName
          title={t('admin.host.setupTitle')}
          message={t('admin.host.setupMessage')}
          confirmLabel={t('admin.host.setup')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            void launch({ operation: 'host.setup', params: me.modules['ssh-hardening'] ? { sshHardeningConfirmed: sshConfirmed } : {} })
          }}
        >
          {me.modules['ssh-hardening'] && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" checked={sshConfirmed} onChange={e => setSshConfirmed(e.target.checked)} />
              {t('admin.host.sshHardeningConfirm')}
            </label>
          )}
        </ConfirmByName>
      )}
      {confirm === 'reboot' && (
        <ConfirmByName
          title={t('admin.host.rebootTitle')}
          message={t('admin.host.rebootMessage')}
          expected={me.hostName}
          danger
          confirmLabel={t('admin.host.reboot')}
          onCancel={() => setConfirm(null)}
          onConfirm={typed => {
            setConfirm(null)
            void launch({ operation: 'host.reboot', confirm: typed })
          }}
        />
      )}
    </div>
  )
}
