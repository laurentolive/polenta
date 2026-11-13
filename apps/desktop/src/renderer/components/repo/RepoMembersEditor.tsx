import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { RepoAccessLevel, RepoMemberGrant } from '@polenta/types'
import { api } from '../../api'

const LEVELS: RepoAccessLevel[] = ['read', 'write', 'admin']

interface Props {
  accountKey: string
  owner: string
  ownerKind: 'user' | 'org'
  /** GH356 — niveau imposé par la forge (repo personnel GitHub) : pas de choix proposé. */
  fixedLevel?: RepoAccessLevel
  value: RepoMemberGrant[]
  onChange: (value: RepoMemberGrant[]) => void
}

/**
 * GH107 — widget Membres (spec GH103 §2.2, design §5) : collaborateurs (login) et, pour une
 * organisation, ses équipes, chacun avec un niveau. En création, il n'accumule que des demandes,
 * appliquées à l'étape `members` ; #108 le réutilise sur un repo existant.
 */
export function RepoMembersEditor({ accountKey, owner, ownerKind, fixedLevel, value, onChange }: Props) {
  const { t } = useTranslation()
  const [login, setLogin] = useState('')
  const [team, setTeam] = useState('')
  const [level, setLevel] = useState<RepoAccessLevel>('write')
  const { data: teams = [] } = useQuery({
    queryKey: ['forge-org-teams', accountKey, owner],
    queryFn: () => api.forge.orgTeams(accountKey, owner),
    enabled: ownerKind === 'org' && !!owner,
    retry: false,
  })
  const has = (kind: RepoMemberGrant['kind'], name: string) => value.some(g => g.kind === kind && g.name.toLowerCase() === name.toLowerCase())
  const add = (kind: RepoMemberGrant['kind'], name: string) => {
    const trimmed = name.trim()
    if (!trimmed || has(kind, trimmed)) return
    onChange([...value, { kind, name: trimmed, level: fixedLevel ?? level }])
  }
  const freeTeams = teams.filter(tm => !has('team', tm.name))

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1" aria-label={t('repoWizard.members.list')}>
          {value.map((g, i) => (
            <li key={`${g.kind}:${g.name}`} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">
                {g.kind === 'team' ? t('repoWizard.members.teamPrefix', { name: teams.find(tm => tm.name === g.name)?.label ?? g.name }) : g.name}
              </span>
              {fixedLevel
                ? <span className="text-xs text-ink-3">{t(`repoWizard.members.level.${fixedLevel}`)}</span>
                : <select value={g.level} aria-label={t('repoWizard.members.levelOf', { name: g.name })} className="input-field py-0.5 text-xs w-auto"
                  onChange={e => onChange(value.map((x, j) => j === i ? { ...x, level: e.target.value as RepoAccessLevel } : x))}>
                  {LEVELS.map(l => <option key={l} value={l}>{t(`repoWizard.members.level.${l}`)}</option>)}
                </select>}
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={t('repoWizard.members.remove', { name: g.name })} className="text-ink-3 hover:text-ink">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input value={login} onChange={e => setLogin(e.target.value)} placeholder={t('repoWizard.members.loginPlaceholder')}
          aria-label={t('repoWizard.members.login')} className="input-field flex-1 text-sm py-1"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add('user', login); setLogin('') } }} />
        {!fixedLevel && (
          <select value={level} onChange={e => setLevel(e.target.value as RepoAccessLevel)} aria-label={t('repoWizard.members.level.label')}
            className="input-field py-1 text-xs w-auto">
            {LEVELS.map(l => <option key={l} value={l}>{t(`repoWizard.members.level.${l}`)}</option>)}
          </select>
        )}
        <button type="button" className="btn-secondary btn-sm" disabled={!login.trim()} onClick={() => { add('user', login); setLogin('') }}>
          {t('repoWizard.members.add')}
        </button>
      </div>
      {fixedLevel && <p className="text-xs text-ink-3">{t('repoWizard.members.fixedLevel')}</p>}
      {ownerKind === 'org' && freeTeams.length > 0 && (
        <div className="flex items-center gap-2">
          <select value={team} onChange={e => setTeam(e.target.value)} aria-label={t('repoWizard.members.team')} className="input-field flex-1 text-sm py-1">
            <option value="">{t('repoWizard.members.teamPlaceholder')}</option>
            {freeTeams.map(tm => <option key={tm.name} value={tm.name}>{tm.label}</option>)}
          </select>
          <button type="button" className="btn-secondary btn-sm" disabled={!team} onClick={() => { add('team', team); setTeam('') }}>
            {t('repoWizard.members.addTeam')}
          </button>
        </div>
      )}
    </div>
  )
}
