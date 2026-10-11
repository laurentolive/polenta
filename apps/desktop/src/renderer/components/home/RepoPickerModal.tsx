import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ForgeAccount, ForgeRepo } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

interface Props {
  /** Comptes Forgejo/Gitea connectés (au moins un), compte par défaut en tête. */
  accounts: ForgeAccount[]
  onPick: (repo: ForgeRepo) => void
  /** « Saisir une URL » : flux d'avant GH45 (TextPromptModal). */
  onEnterUrl: () => void
  onCancel: () => void
}

/**
 * GH45 S4 — « Ouvrir un projet depuis un repo » avec un compte Forgejo/Gitea (spec §6.1) : repos
 * accessibles à ce compte, recherche sur `organisation/nom`, badge « lecture seule ».
 */
export function RepoPickerModal({ accounts, onPick, onEnterUrl, onCancel }: Props) {
  const { t } = useTranslation()
  const [accountKey, setAccountKey] = useState(accounts[0].key)
  const [filter, setFilter] = useState('')
  useModalHotkeys(onCancel)

  const { data: repos, error, isLoading } = useQuery({
    queryKey: ['forge-repos', accountKey],
    queryFn: () => api.forge.listRepos(accountKey),
    retry: false,
  })

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (repos ?? []).filter(r => !q || r.fullName.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
  }, [repos, filter])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 space-y-3 flex flex-col max-h-[80vh]">
        <h2 className="text-sm font-semibold text-ink">{t('home.openFromRepo')}</h2>
        {accounts.length > 1 && (
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-2">{t('home.server.account')}</span>
            <select value={accountKey} onChange={e => setAccountKey(e.target.value)} className="input-field w-full">
              {accounts.map(a => <option key={a.key} value={a.key}>{a.login} — {a.host}</option>)}
            </select>
          </label>
        )}
        <input value={filter} onChange={e => setFilter(e.target.value)} autoFocus
          placeholder={t('home.server.searchRepos')} aria-label={t('home.server.searchRepos')} className="input-field w-full" />
        <div className="flex-1 min-h-[8rem] overflow-y-auto border border-edge rounded" role="listbox" aria-label={t('home.server.repoList')}>
          {isLoading && <p className="p-3 text-sm text-ink-3">{t('common.loading')}</p>}
          {error && (
            <p className="p-3 text-sm text-status-danger">{error instanceof Error ? error.message : String(error)}</p>
          )}
          {repos && shown.length === 0 && (
            <p className="p-3 text-sm text-ink-3">{repos.length === 0 ? t('home.server.noRepos') : t('home.server.noMatch')}</p>
          )}
          {shown.map(repo => (
            <button key={repo.fullName} type="button" role="option" aria-selected={false} onClick={() => onPick(repo)}
              className="w-full text-left px-3 py-2 border-b border-edge last:border-b-0 hover:bg-surface-hover">
              <span className="flex items-center gap-2">
                <span className="text-sm text-ink font-mono truncate">{repo.fullName}</span>
                {repo.readOnly && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-status-warning-bg text-status-warning border border-status-warning-border shrink-0">
                    {t('home.server.readOnly')}
                  </span>
                )}
              </span>
              {repo.description && <span className="block text-xs text-ink-3 truncate">{repo.description}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={onEnterUrl} className="text-xs text-ink-2 underline hover:text-ink">
            {t('home.server.enterUrl')}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
