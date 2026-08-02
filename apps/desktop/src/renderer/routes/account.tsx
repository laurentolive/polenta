import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sun, Moon } from 'lucide-react'
import { api } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { ViewHeader } from '../components/layout/ViewHeader'

export const Route = createFileRoute('/account')({
  component: AccountPage,
})

interface Identity {
  login: string
  name: string
  email: string
  remote: string
}

const KNOWN_REMOTES = [
  'https://github.com',
  'https://gitlab.com',
]

function AccountPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      for (const remote of KNOWN_REMOTES) {
        try {
          const token = await api.auth.getToken(remote)
          if (!token) continue
          const id = await api.auth.resolveIdentity(remote)
          setIdentity({ ...id, remote })
          break
        } catch {
          // try next
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleLogout() {
    if (identity) {
      try { await api.auth.deleteToken(identity.remote) } catch { /* best-effort */ }
    }
    await navigate({ to: '/login' })
  }

  if (loading) return <p className="text-sm text-ink-3 p-4">{t('common.loading')}</p>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader title={t('account.page.title')} />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-lg p-6 space-y-6">
      {/* Identity card */}
      <div className="bg-surface border border-edge rounded-xl p-5 space-y-1">
        <p className="text-sm font-medium text-ink">{identity?.name ?? '—'}</p>
        {identity?.login && <p className="text-xs text-ink-2 font-mono">@{identity.login}</p>}
        {identity?.email && <p className="text-xs text-ink-2">{identity.email}</p>}
        <p className="text-xs text-ink-3 font-mono">{identity?.remote ?? '—'}</p>
      </div>

      {/* Preferences */}
      <div className="bg-surface border border-edge rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-medium text-ink">{t('account.page.preferencesTitle')}</h2>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-2">{t('account.page.themeLabel')}</span>
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-edge text-sm text-ink-2 hover:bg-hover transition-colors"
          >
            {theme === 'dark'
              ? <><Sun size={14} className="text-status-warning" /><span>{t('account.page.modeLight')}</span></>
              : <><Moon size={14} className="text-ink-3" /><span>{t('account.page.modeDark')}</span></>}
          </button>
        </div>
      </div>

      {/* Account actions */}
      <div className="bg-surface border border-edge rounded-xl p-5 space-y-2">
        <h2 className="text-sm font-medium text-ink">{t('account.page.accountTitle')}</h2>
        <button
          type="button"
          onClick={() => navigate({ to: '/login' })}
          className="w-full text-left px-3 py-2 text-sm rounded border border-edge text-ink-2 hover:bg-hover transition-colors"
        >
          {t('common.changeAccount')}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full text-left px-3 py-2 text-sm rounded border border-status-danger-border text-status-danger hover:bg-status-danger-bg transition-colors"
        >
          {t('common.logout')}
        </button>
      </div>
      </div>
      </div>
    </div>
  )
}
