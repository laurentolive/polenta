import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Sun, Moon, Languages } from 'lucide-react'
import { api } from '../../api'
import { useTheme } from '../../contexts/ThemeContext'
import { useLocale } from '../../i18n/useLocale'
import { capabilities } from '../../platform'
import { useCurrentAccount } from '../../hooks/useCurrentAccount'
import { useTeamConfig } from '../../hooks/useTeamConfig'
import { BRAND } from '../../../shared/brand'
import { NETWORK_TIMEOUT_MAX, NETWORK_TIMEOUT_MIN, normalizeNetworkTimeout } from '../../../shared/network-timeout'

export function AccountPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const { locale, setLocale } = useLocale()
  const { account: identity, loading, logout } = useCurrentAccount()
  // GH26 — préférence app-level (userData), lue par le main au démarrage suivant.
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean | null>(null)
  // GH45 — verrouillée par la configuration machine (autoUpdate: false).
  const [autoUpdateLocked, setAutoUpdateLocked] = useState(false)
  // GH34 — dossier de la bibliothèque de gabarits d'export (préférence app-level).
  const [templatesDir, setTemplatesDir] = useState<string | null>(null)
  // GH15 — délai de connexion réseau (s) : valeur enregistrée et saisie en cours.
  const [networkTimeout, setNetworkTimeout] = useState<number | null>(null)
  const [networkTimeoutDraft, setNetworkTimeoutDraft] = useState('')

  useEffect(() => {
    api.app.getSettings().then(s => {
      setAutoCheckUpdates(s.autoCheckUpdates)
      setAutoUpdateLocked(s.autoCheckUpdatesLocked === true)
      setTemplatesDir(s.exportTemplatesDir ?? '')
      if (s.networkTimeoutSeconds !== undefined) {
        setNetworkTimeout(s.networkTimeoutSeconds)
        setNetworkTimeoutDraft(String(s.networkTimeoutSeconds))
      }
    }).catch(() => {})
  }, [])

  async function handleSetTemplatesDir(dir: string) {
    const saved = await api.app.setSettings({ exportTemplatesDir: dir })
    setTemplatesDir(saved.exportTemplatesDir ?? '')
  }

  const [examplesMessage, setExamplesMessage] = useState<string | null>(null)
  async function handleInstallExamples() {
    try {
      const { folder, copied } = await api.export.installExampleTemplates()
      setExamplesMessage(t('account.panel.exportTemplatesExamplesDone', { count: copied, folder }))
    } catch (err) {
      setExamplesMessage(err instanceof Error ? err.message : String(err))
    }
  }

  async function handlePickTemplatesDir() {
    const picked = await api.dialog.pickFolder(t('account.panel.exportTemplatesPick'))
    if (picked) await handleSetTemplatesDir(picked)
  }

  async function handleToggleAutoUpdate(value: boolean) {
    setAutoCheckUpdates(value)
    try {
      const saved = await api.app.setSettings({ autoCheckUpdates: value })
      setAutoCheckUpdates(saved.autoCheckUpdates)
    } catch {
      setAutoCheckUpdates(!value)
    }
  }

  async function handleCommitNetworkTimeout() {
    if (networkTimeout === null) return
    const value = Number(networkTimeoutDraft)
    // Saisie invalide (hors bornes, décimale, texte) : on revient à la valeur enregistrée.
    if (normalizeNetworkTimeout(value) !== value || value === networkTimeout) {
      setNetworkTimeoutDraft(String(networkTimeout))
      return
    }
    try {
      const saved = await api.app.setSettings({ networkTimeoutSeconds: value })
      setNetworkTimeout(saved.networkTimeoutSeconds ?? value)
      setNetworkTimeoutDraft(String(saved.networkTimeoutSeconds ?? value))
    } catch {
      setNetworkTimeoutDraft(String(networkTimeout))
    }
  }

  async function handleLogout() {
    await logout()
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-edge">
        <p className="section-label">{t('account.panel.title')}</p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-ink-3">{t('common.loading')}</p>
        </div>
      ) : identity ? (
        <div className="flex flex-col flex-1 p-4 gap-4 overflow-y-auto">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-ink">{identity.name}</p>
            {identity.login && (
              <p className="text-xs text-ink-2 font-mono">@{identity.login}</p>
            )}
            {identity.email && (
              <p className="text-xs text-ink-2">{identity.email}</p>
            )}
            <p className="text-xs text-ink-3 font-mono">{identity.remote}</p>
            {identity.provider === 'forgejo' && (
              <p className="text-xs text-ink-3 pt-1">{t('account.panel.forgeTokenHint')}</p>
            )}
            {identity.provider === 'forgejo' && <TeamConfigLine />}
          </div>

          <div className="border-t border-edge-subtle pt-4 flex flex-col gap-2">
            {capabilities.accountManagement && (
              <button
                type="button"
                onClick={() => navigate({ to: '/login' })}
                className="w-full text-left px-3 py-2 text-sm rounded border border-edge text-ink-2 hover:bg-hover transition-colors"
              >
                {t('common.changeAccount')}
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-sm rounded border border-status-danger-border text-status-danger hover:bg-status-danger-bg transition-colors"
            >
              {t('common.logout')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 p-4 gap-3 items-center justify-center text-center">
          <p className="text-xs text-ink-3">{t('account.panel.notConnected')}</p>
          <button
            type="button"
            onClick={() => navigate({ to: '/login' })}
            className="px-3 py-1.5 text-sm rounded border border-edge text-ink-2 hover:bg-hover transition-colors"
          >
            {t('account.panel.connect')}
          </button>
        </div>
      )}

      {/* Preferences */}
      <div className="border-t border-edge px-4 py-3 space-y-2">
        <p className="section-label mb-2">{t('account.panel.preferences')}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-2">{t('account.panel.theme')}</span>
          <button
            type="button"
            onClick={toggle}
            title={theme === 'dark' ? t('account.panel.themeToLight') : t('account.panel.themeToDark')}
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-edge text-xs text-ink-2 hover:bg-hover transition-colors"
          >
            {theme === 'dark' ? (
              <>
                <Sun size={13} className="text-status-warning" />
                <span>{t('account.panel.light')}</span>
              </>
            ) : (
              <>
                <Moon size={13} className="text-ink-3" />
                <span>{t('account.panel.dark')}</span>
              </>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-2">{t('account.panel.language')}</span>
          <button
            type="button"
            onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-edge text-xs text-ink-2 hover:bg-hover transition-colors"
          >
            <Languages size={13} className="text-ink-3" />
            <span>{locale === 'fr' ? t('account.panel.english') : t('account.panel.french')}</span>
          </button>
        </div>
        {/* GH49 — marque sans source de mise à jour : préférence sans objet, masquée. */}
        {capabilities.autoUpdate && BRAND.update && autoCheckUpdates !== null && (
          <label className="flex items-center justify-between gap-2 cursor-pointer"
            title={autoUpdateLocked ? t('account.panel.autoUpdateLocked') : t('account.panel.autoUpdateHint')}>
            <span className="text-xs text-ink-2">{t('account.panel.autoUpdate')}</span>
            <input
              type="checkbox"
              checked={autoCheckUpdates}
              disabled={autoUpdateLocked}
              onChange={e => void handleToggleAutoUpdate(e.target.checked)}
            />
          </label>
        )}
        {capabilities.networkTimeout && networkTimeout !== null && (
          <label className="flex items-center justify-between gap-2" title={t('account.panel.networkTimeoutHint')}>
            <span className="text-xs text-ink-2">{t('account.panel.networkTimeout')}</span>
            <input
              type="number"
              min={NETWORK_TIMEOUT_MIN}
              max={NETWORK_TIMEOUT_MAX}
              step={1}
              value={networkTimeoutDraft}
              onChange={e => setNetworkTimeoutDraft(e.target.value)}
              onBlur={() => void handleCommitNetworkTimeout()}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className="w-16 px-1.5 py-0.5 rounded border border-edge bg-transparent text-xs text-ink-2 text-right"
            />
          </label>
        )}
        {templatesDir !== null && (
          <div className="space-y-1" title={t('account.panel.exportTemplatesHint')}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-2">{t('account.panel.exportTemplates')}</span>
              {capabilities.localFilesystem && <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => void handlePickTemplatesDir()}
                  className="px-2 py-1 rounded border border-edge text-xs text-ink-2 hover:bg-hover transition-colors"
                >
                  {t('account.panel.exportTemplatesChoose')}
                </button>
                {templatesDir && (
                  <button
                    type="button"
                    onClick={() => void handleSetTemplatesDir('')}
                    className="px-2 py-1 rounded border border-edge text-xs text-ink-2 hover:bg-hover transition-colors"
                  >
                    {t('account.panel.exportTemplatesClear')}
                  </button>
                )}
              </div>}
            </div>
            <p className="text-xs text-ink-3 break-all">
              {templatesDir || t('account.panel.exportTemplatesNone')}
            </p>
            {templatesDir && (
              <button
                type="button"
                onClick={() => void handleInstallExamples()}
                title={t('account.panel.exportTemplatesExamplesHint')}
                className="px-2 py-1 rounded border border-edge text-xs text-ink-2 hover:bg-hover transition-colors"
              >
                {t('account.panel.exportTemplatesExamples')}
              </button>
            )}
            {examplesMessage && <p className="text-xs text-ink-3 break-all">{examplesMessage}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

/** GH45 S2b — état de la configuration du serveur (spec §3bis-4). */
function TeamConfigLine() {
  const { t } = useTranslation()
  const status = useTeamConfig()
  if (!status) return null
  let text: string
  if (status.error) text = t('account.panel.teamConfigError', { error: status.error })
  else if (!status.config) text = t('account.panel.teamConfigNone')
  else if (status.config.teams.length > 0) text = t('account.panel.teamConfigTeams', { teams: status.config.teams.join(', ') })
  else text = t('account.panel.teamConfigDefaults')
  return (
    <p className="text-xs text-ink-3 pt-1" title={status.warnings.join('\n') || undefined}>
      {text}{status.warnings.length > 0 ? ` ${t('account.panel.teamConfigWarnings', { count: status.warnings.length })}` : ''}
    </p>
  )
}
