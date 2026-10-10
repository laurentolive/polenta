import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ForgeAccount } from '@polenta/types'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { ServerTargetFields, useCreatableOrgs, type ServerTarget } from './ServerTargetFields'

interface Props {
  /** Comptes Forgejo/Gitea connectés (au moins un). */
  accounts: ForgeAccount[]
  onLocal: (name: string) => void
  onServer: (name: string, target: ServerTarget) => void
  onCancel: () => void
}

/**
 * GH45 S4 — « Créer un nouveau projet » avec un compte Forgejo/Gitea (spec §6.2) : création locale
 * (inchangée) ou sur le serveur, dans une organisation où le compte peut créer. Sans organisation
 * éligible, l'option serveur est désactivée avec l'explication.
 */
export function CreateProjectModal({ accounts, onLocal, onServer, onCancel }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [target, setTarget] = useState<ServerTarget>({ accountKey: accounts[0].key, org: '' })
  const [where, setWhere] = useState<'server' | 'local' | null>(null)
  const { data: orgs, isLoading, error } = useCreatableOrgs(target.accountKey)
  const host = accounts.find(a => a.key === target.accountKey)?.host ?? accounts[0].host
  const serverAvailable = (orgs?.length ?? 0) > 0
  // Sur le serveur par défaut dès qu'il est possible ; le choix de l'utilisateur l'emporte ensuite,
  // sauf si le compte choisi ne peut créer nulle part (option désactivée).
  const choice = serverAvailable ? (where ?? 'server') : 'local'
  const trimmed = name.trim()
  const canSubmit = !!trimmed && (choice === 'local' || (serverAvailable && !!target.org))
  const onTargetChange = useCallback((next: ServerTarget) => setTarget(next), [])

  useModalHotkeys(onCancel)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    if (choice === 'server') onServer(trimmed, target)
    else onLocal(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onCancel}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-sm font-semibold text-ink">{t('home.createNew')}</h2>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-2">{t('home.projectNameLabel')}</span>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus className="input-field w-full" />
        </label>
        {accounts.length > 1 && (
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-2">{t('home.server.account')}</span>
            <select value={target.accountKey} onChange={e => setTarget({ accountKey: e.target.value, org: '' })} className="input-field w-full">
              {accounts.map(a => <option key={a.key} value={a.key}>{a.login} — {a.host}</option>)}
            </select>
          </label>
        )}
        <fieldset className="space-y-2">
          <label className={`flex items-start gap-2 text-sm ${serverAvailable ? 'text-ink cursor-pointer' : 'text-ink-3'}`}>
            <input type="radio" name="where" className="mt-1" checked={choice === 'server'} disabled={!serverAvailable}
              onChange={() => setWhere('server')} />
            <span>
              {t('home.server.onServer', { host })}
              {isLoading && <span className="block text-xs text-ink-3">{t('common.loading')}</span>}
              {!isLoading && !serverAvailable && (
                <span className="block text-xs text-ink-3">
                  {error ? (error instanceof Error ? error.message : String(error)) : t('home.server.noCreatableOrg', { host })}
                </span>
              )}
            </span>
          </label>
          {choice === 'server' && (
            <div className="pl-6">
              {/* Compte choisi au-dessus : il reste modifiable même si celui-ci n'a aucune organisation. */}
              <ServerTargetFields accounts={[]} value={target} onChange={onTargetChange} orgs={orgs} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input type="radio" name="where" checked={choice === 'local'} onChange={() => setWhere('local')} />
            {t('home.server.onThisComputer')}
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={!canSubmit} className="btn-primary">{t('home.continue')}</button>
        </div>
      </form>
    </div>
  )
}
