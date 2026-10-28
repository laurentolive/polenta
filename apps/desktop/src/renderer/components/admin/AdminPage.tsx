import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi, type InstanceRow } from '../../lib/adminApi'
import { useAdminMe } from '../../hooks/useAdmin'
import { ViewHeader } from '../layout/ViewHeader'
import { BackupsPanel } from './BackupsPanel'
import { DnsCheck } from './DnsCheck'
import { ExportsPanel } from './ExportsPanel'
import { HostPanel } from './HostPanel'
import { InstancesPanel } from './InstancesPanel'
import { JournalPanel } from './JournalPanel'
import { StoragePanel } from './StoragePanel'
import { UsersPanel } from './UsersPanel'

type Tab = 'instances' | 'backups' | 'exports' | 'users' | 'host' | 'storage' | 'journal' | 'dns'

/**
 * GH63 — page Administration (version web, propriétaires de l'organisation). Niveau « instance » :
 * sa propre instance ; niveau « hôte » (instance d'exploitation) : toutes les instances et l'hôte.
 */
export function AdminPage() {
  const { t } = useTranslation()
  const { me, loading } = useAdminMe()
  const [tab, setTab] = useState<Tab>('instances')
  const [rows, setRows] = useState<InstanceRow[]>([])
  const instances = rows.map(r => r.name)

  useEffect(() => {
    if (me) adminApi.instances().then(setRows).catch(() => {})
  }, [me])

  if (loading) return <p className="text-sm text-ink-3 p-4">{t('common.loading')}</p>
  if (!me) return <p className="text-sm text-ink-3 p-4" role="status">{t('admin.unavailable')}</p>

  const tabs: Tab[] = me.level === 'host'
    ? ['instances', 'backups', 'exports', 'users', 'host', 'storage', 'journal', 'dns']
    : ['instances', 'backups', 'exports', 'users', 'journal', 'dns']

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader title={t('admin.title')} />
      <div className="px-6 pt-3 text-xs text-ink-3">
        {t(me.level === 'host' ? 'admin.levelHost' : 'admin.levelInstance', { instance: me.instance, host: me.hostName })}
      </div>
      <div className="flex gap-1 px-6 pt-3 border-b border-edge" role="tablist" aria-label={t('admin.title')}>
        {tabs.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`admin-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`admin-panel-${id}`}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-sm rounded-t ${tab === id ? 'border border-b-0 border-edge bg-surface text-ink font-medium' : 'text-ink-2 hover:text-ink'}`}
          >
            {t(`admin.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6" role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'instances' && <InstancesPanel me={me} />}
        {tab === 'backups' && <BackupsPanel me={me} instances={instances.length ? instances : [me.instance]} />}
        {tab === 'exports' && <ExportsPanel me={me} instances={instances.length ? instances : [me.instance]} />}
        {tab === 'users' && <UsersPanel me={me} rows={rows} />}
        {tab === 'host' && <HostPanel me={me} />}
        {tab === 'storage' && <StoragePanel />}
        {tab === 'journal' && <JournalPanel />}
        {tab === 'dns' && <DnsCheck />}
      </div>
    </div>
  )
}
