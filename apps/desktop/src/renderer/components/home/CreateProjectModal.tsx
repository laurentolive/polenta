import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ForgeAccount } from '@polenta/types'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { backdropDismiss } from '../../lib/backdropDismiss'

interface Props {
  /** Comptes GitHub et Forgejo connectés (au moins un). */
  accounts: ForgeAccount[]
  onLocal: (name: string) => void
  /** GH107 — ouvre l'assistant « Ajouter un repo », nom pré-rempli. */
  onServer: (name: string) => void
  onCancel: () => void
}

/**
 * GH45 S4 — « Créer un nouveau projet » avec un compte de forge (spec §6.2) : création locale
 * (inchangée) ou sur le serveur. GH107 — le serveur ouvre l'assistant « Ajouter un repo »
 * (GH103 §2.1), qui propose le compte lui-même et les organisations où il peut créer.
 */
export function CreateProjectModal({ accounts, onLocal, onServer, onCancel }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [choice, setChoice] = useState<'server' | 'local'>('server')
  const trimmed = name.trim()
  const hosts = [...new Set(accounts.map(a => a.host))]

  useModalHotkeys(onCancel)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (choice === 'server') onServer(trimmed)
    else if (trimmed) onLocal(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" {...backdropDismiss(onCancel)}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-sm font-semibold text-ink">{t('home.createNew')}</h2>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-2">{t('home.projectNameLabel')}</span>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus className="input-field w-full" />
        </label>
        <fieldset className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
            <input type="radio" name="where" className="mt-1" checked={choice === 'server'} onChange={() => setChoice('server')} />
            <span>{hosts.length === 1 ? t('home.server.onServer', { host: hosts[0] }) : t('home.server.onAServer')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input type="radio" name="where" checked={choice === 'local'} onChange={() => setChoice('local')} />
            {t('home.server.onThisComputer')}
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={choice === 'local' && !trimmed} className="btn-primary">{t('home.continue')}</button>
        </div>
      </form>
    </div>
  )
}
