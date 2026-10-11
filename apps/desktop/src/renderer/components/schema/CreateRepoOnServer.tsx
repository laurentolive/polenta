import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { ServerTargetFields, useCreatableOrgs, type ServerTarget } from '../home/ServerTargetFields'

interface Props {
  /** Nom proposé pour le repo (nom de montage saisi au-dessus). */
  suggestedName: string
  /** URL de clone du repo créé, à inscrire dans le champ URL de la fenêtre d'ajout. */
  onCreated: (cloneUrl: string) => void
}

/**
 * GH45 S4 — « Créer le repo sur le serveur » dans l'ajout d'un composant (spec §6.5) : repo privé
 * créé et initialisé dans une organisation où le compte peut créer ; son URL remplit le champ URL,
 * l'ajout se poursuit comme pour un repo existant. Absent sans compte Forgejo/Gitea.
 */
export function CreateRepoOnServer({ suggestedName, onCreated }: Props) {
  const { t } = useTranslation()
  const { data: accounts = [] } = useQuery({ queryKey: ['forge-accounts'], queryFn: () => api.forge.accounts(), retry: false })
  const [open, setOpen] = useState(false)
  const [repoName, setRepoName] = useState<string | null>(null)
  const [target, setTarget] = useState<ServerTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const current = target ?? (accounts[0] ? { accountKey: accounts[0].key, org: '' } : null)
  const { data: orgs, isLoading } = useCreatableOrgs(open ? current?.accountKey : undefined)
  const onTargetChange = useCallback((next: ServerTarget) => setTarget(next), [])

  if (accounts.length === 0 || !current) return null
  const name = (repoName ?? suggestedName).trim()

  const create = async () => {
    if (!name || !current.org) return
    setBusy(true)
    setError(null)
    try {
      const { cloneUrl } = await api.workspace.createComponentOnServer(current.accountKey, current.org, name)
      setCreated(`${current.org}/${name}`)
      setOpen(false)
      onCreated(cloneUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="text-xs">
        {created && <p className="text-status-success mb-1">{t('schema.addDependency.server.created', { repo: created })}</p>}
        <button type="button" onClick={() => setOpen(true)} className="text-ink-2 underline hover:text-ink">
          {t('schema.addDependency.server.create')}
        </button>
      </div>
    )
  }

  return (
    // Entrée crée le repo ici : elle ne doit pas valider la fenêtre d'ajout (URL encore vide).
    <div className="border border-edge rounded p-3 space-y-2"
      onKeyDown={e => {
        if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'BUTTON') return
        e.preventDefault()
        e.stopPropagation()
        void create()
      }}>
      <p className="text-xs font-medium text-ink">{t('schema.addDependency.server.create')}</p>
      {isLoading && <p className="text-xs text-ink-3">{t('common.loading')}</p>}
      {orgs && orgs.length === 0 && (
        <p className="text-xs text-ink-3">
          {t('home.server.noCreatableOrg', { host: accounts.find(a => a.key === current.accountKey)?.host ?? '' })}
        </p>
      )}
      <ServerTargetFields accounts={accounts} value={current} onChange={onTargetChange} orgs={orgs} />
      <label className="block space-y-1">
        <span className="text-xs text-ink-2">{t('schema.addDependency.server.repoName')}</span>
        <input value={repoName ?? suggestedName} onChange={e => setRepoName(e.target.value)}
          className="input-field w-full font-mono text-xs py-1.5" />
      </label>
      {error && <p className="text-xs text-status-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary btn-sm" disabled={busy}>{t('common.cancel')}</button>
        <button type="button" onClick={create} className="btn-primary btn-sm"
          disabled={busy || !name || !current.org || !orgs || orgs.length === 0}>
          {busy ? t('schema.addDependency.server.creating') : t('schema.addDependency.server.confirm')}
        </button>
      </div>
    </div>
  )
}
