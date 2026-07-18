import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Sun, Moon } from 'lucide-react'
import { api } from '../../api'
import { useTheme } from '../../contexts/ThemeContext'

interface Identity {
  login: string
  name: string
  email: string
  remote: string
}

const KNOWN_REMOTES = [
  'https://github.com',
  'https://gitlab.com',
  'https://gitea.io',
]

export function AccountPanel() {
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
          setLoading(false)
          return
        } catch {
          // try next remote
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleLogout() {
    if (identity) {
      try {
        await api.auth.deleteToken(identity.remote)
      } catch {
        // best-effort
      }
    }
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-edge">
        <p className="section-label">Compte</p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-ink-3">Chargement…</p>
        </div>
      ) : identity ? (
        <div className="flex flex-col flex-1 p-4 gap-4 overflow-y-auto">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-ink">{identity.name}</p>
            {identity.email && (
              <p className="text-xs text-ink-2">{identity.email}</p>
            )}
            <p className="text-xs text-ink-3 font-mono">{identity.remote}</p>
          </div>

          <div className="border-t border-edge-subtle pt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => navigate({ to: '/login' })}
              className="w-full text-left px-3 py-2 text-sm rounded border border-edge text-ink-2 hover:bg-hover transition-colors"
            >
              Changer de compte…
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700/60 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 p-4 gap-3 items-center justify-center text-center">
          <p className="text-xs text-ink-3">Non connecté</p>
          <button
            type="button"
            onClick={() => navigate({ to: '/login' })}
            className="px-3 py-1.5 text-sm rounded border border-edge text-ink-2 hover:bg-hover transition-colors"
          >
            Se connecter…
          </button>
        </div>
      )}

      {/* Preferences */}
      <div className="border-t border-edge px-4 py-3">
        <p className="section-label mb-2">Préférences</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-2">Thème</span>
          <button
            type="button"
            onClick={toggle}
            title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-edge text-xs text-ink-2 hover:bg-hover transition-colors"
          >
            {theme === 'dark' ? (
              <>
                <Sun size={13} className="text-amber-400" />
                <span>Clair</span>
              </>
            ) : (
              <>
                <Moon size={13} className="text-ink-3" />
                <span>Sombre</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
