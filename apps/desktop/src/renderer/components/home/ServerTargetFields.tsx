import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ForgeAccount, ForgeOrg } from '@polenta/types'
import { api } from '../../api'

/** GH45 S4 — organisations où le compte peut créer un repo (spec §6.2). */
export function useCreatableOrgs(accountKey: string | undefined) {
  return useQuery({
    queryKey: ['forge-creatable-orgs', accountKey],
    queryFn: () => api.forge.creatableOrgs(accountKey!),
    enabled: !!accountKey,
    retry: false,
  })
}

export interface ServerTarget {
  accountKey: string
  org: string
}

interface Props {
  accounts: ForgeAccount[]
  value: ServerTarget
  onChange: (value: ServerTarget) => void
  orgs: ForgeOrg[] | undefined
}

/**
 * GH45 S4 — compte (s'il y en a plusieurs) et organisation de destination d'un repo créé sur le
 * serveur ; seules les organisations où le compte peut créer sont proposées. Partagé par la
 * création de projet (accueil) et l'ajout de composant.
 */
export function ServerTargetFields({ accounts, value, onChange, orgs }: Props) {
  const { t } = useTranslation()

  // Première organisation éligible choisie d'office (et après un changement de compte).
  useEffect(() => {
    if (orgs && orgs.length > 0 && !orgs.some(o => o.name === value.org)) onChange({ ...value, org: orgs[0].name })
  }, [orgs, value, onChange])

  return (
    <div className="space-y-2">
      {accounts.length > 1 && (
        <label className="block space-y-1">
          <span className="text-xs text-ink-2">{t('home.server.account')}</span>
          <select value={value.accountKey} onChange={e => onChange({ accountKey: e.target.value, org: '' })} className="input-field w-full">
            {accounts.map(a => <option key={a.key} value={a.key}>{a.login} — {a.host}</option>)}
          </select>
        </label>
      )}
      {orgs && orgs.length > 0 && (
        <label className="block space-y-1">
          <span className="text-xs text-ink-2">{t('home.server.organization')}</span>
          <select value={value.org} onChange={e => onChange({ ...value, org: e.target.value })} className="input-field w-full">
            {orgs.map(o => <option key={o.name} value={o.name}>{o.label ? `${o.name} — ${o.label}` : o.name}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
