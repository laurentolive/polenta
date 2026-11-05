import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Settings2, X } from 'lucide-react'
import type { ForgeCollaborator, ForgeRepoTeam, RepoAccessLevel, RepoSettings, RepoVisibility } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

const LEVELS: RepoAccessLevel[] = ['read', 'write', 'admin']
type Loaded = Extract<RepoSettings, { available: true }>

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err)

/**
 * GH108 — icône de la ligne d'un repo (spec GH103 §3.1) : seulement si `origin` est sur une forge
 * `github` ou `forgejo` d'un compte connecté. La vérification ne fait aucun appel réseau.
 */
export function RepoSettingsButton({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: available } = useQuery({
    queryKey: ['forge-repo-settings-available', repoPath],
    queryFn: () => api.forge.repoSettingsAvailable(repoPath),
    retry: false,
  })
  if (!available) return null
  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); setOpen(true) }} title={t('repoSettings.title')}
        className="text-ink-3 hover:text-ink shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Settings2 size={12} />
      </button>
      {open && createPortal(<RepoSettingsModal repoPath={repoPath} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

/** GH108 — sections Général et Membres (spec GH103 §3.2, design §2). */
function RepoSettingsModal({ repoPath, onClose }: { repoPath: string; onClose: () => void }) {
  const { t } = useTranslation()
  const queryKey = ['forge-repo-settings', repoPath]
  const { data, error, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.forge.repoSettings(repoPath),
    retry: false,
    staleTime: 0,
  })
  useModalHotkeys(onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={e => { e.stopPropagation(); onClose() }}>
      <div role="dialog" aria-label={t('repoSettings.title')} onClick={e => e.stopPropagation()}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{t('repoSettings.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-ink-3 hover:text-ink"><X size={16} /></button>
        </div>
        {isLoading && <p className="text-sm text-ink-3">{t('common.loading')}</p>}
        {error && <p className="text-sm text-status-danger">{messageOf(error)}</p>}
        {data && !data.available && <p className="text-sm text-ink-2">{t('repoSettings.offline')}</p>}
        {data?.available && (
          <>
            <p className="text-sm font-mono text-ink-2">{data.fullName}</p>
            {!data.details.permissions.admin && <p className="text-xs text-ink-3">{t('repoSettings.adminOnly')}</p>}
            <GeneralSection repoPath={repoPath} settings={data} queryKey={queryKey} />
            <MembersSection repoPath={repoPath} settings={data} queryKey={queryKey} />
          </>
        )}
      </div>
    </div>
  )
}

interface SectionProps {
  repoPath: string
  settings: Loaded
  queryKey: string[]
}

function GeneralSection({ repoPath, settings, queryKey }: SectionProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isAdmin = settings.details.permissions.admin
  const [description, setDescription] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmPublic, setConfirmPublic] = useState(false)
  // Texte enregistré sur la forge, à reporter dans le README si l'utilisateur le confirme.
  const [askReadme, setAskReadme] = useState<string | null>(null)
  const value = description ?? settings.details.description
  const changed = value.trim() !== settings.details.description.trim()

  const run = async (op: () => Promise<void>) => {
    setBusy(true)
    setFailure(null)
    setNotice(null)
    try {
      await op()
    } catch (err) {
      setFailure(messageOf(err))
    } finally {
      setBusy(false)
      await qc.invalidateQueries({ queryKey })
    }
  }

  const saveDescription = () => run(async () => {
    const saved = value.trim()
    await api.forge.updateRepoSettings(repoPath, { description: saved })
    // Relu avant d'abandonner la saisie : l'ancien texte ne réapparaît pas entre-temps.
    await qc.invalidateQueries({ queryKey })
    setDescription(null)
    const state = await api.forge.readmeState(repoPath)
    if (state === 'free') setNotice(t('repoSettings.readme.free'))
    else setAskReadme(saved)
  })

  const syncReadme = (text: string) => run(async () => {
    setAskReadme(null)
    const outcome = await api.forge.syncReadme(repoPath, text)
    if (outcome.status === 'committed') setNotice(outcome.pushError ? t('repoSettings.readme.pushFailed', { message: outcome.pushError }) : t('repoSettings.readme.committed'))
    else if (outcome.status === 'not-on-integration') setNotice(t('repoSettings.readme.notOnIntegration', { branch: outcome.branch }))
    else setNotice(t(`repoSettings.readme.${outcome.status === 'pending-changes' ? 'pending' : outcome.status}`))
  })

  const setVisibility = (visibility: RepoVisibility) => run(async () => {
    setConfirmPublic(false)
    await api.forge.updateRepoSettings(repoPath, { visibility })
  })

  return (
    <section className="space-y-3" aria-label={t('repoSettings.general')}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t('repoSettings.general')}</h3>
      <div className="space-y-1">
        <span className="block text-xs text-ink-2">{t('repoSettings.description')}</span>
        {isAdmin ? (
          <div className="flex items-start gap-2">
            <textarea value={value} onChange={e => setDescription(e.target.value)} rows={2} className="input-field flex-1 text-sm" aria-label={t('repoSettings.description')} />
            <button type="button" className="btn-secondary btn-sm" disabled={busy || !changed || !value.trim()} onClick={() => void saveDescription()}>{t('common.save')}</button>
          </div>
        ) : <p className="text-sm text-ink whitespace-pre-line">{settings.details.description || t('repoSettings.noDescription')}</p>}
      </div>
      {askReadme !== null && (
        <div role="alertdialog" aria-label={t('repoSettings.readme.ask')} className="border border-edge rounded p-3 space-y-2 text-sm">
          <p>{t('repoSettings.readme.ask')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setAskReadme(null)}>{t('repoSettings.readme.no')}</button>
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void syncReadme(askReadme)}>{t('repoSettings.readme.yes')}</button>
          </div>
        </div>
      )}
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">{t('repoSettings.visibility')}</legend>
        <div className="flex gap-4 text-sm">
          {(['private', 'public'] as const).map(v => (
            <label key={v} className={`flex items-center gap-1.5 ${isAdmin ? 'cursor-pointer' : ''}`}>
              <input type="radio" name="repo-visibility" disabled={!isAdmin || busy} checked={settings.details.visibility === v}
                onChange={() => { if (v === 'public') setConfirmPublic(true); else void setVisibility('private') }} />
              {t(`repoWizard.${v}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {confirmPublic && (
        <div role="alertdialog" aria-label={t('repoSettings.publicConfirm')} className="border border-status-warning-border bg-status-warning-bg rounded p-3 space-y-2 text-sm">
          <p>{t('repoSettings.publicConfirm')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmPublic(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void setVisibility('public')}>{t('repoSettings.makePublic')}</button>
          </div>
        </div>
      )}
      {notice && <p className="text-xs text-ink-2">{notice}</p>}
      {failure && <p className="text-xs text-status-danger whitespace-pre-line">{failure}</p>}
    </section>
  )
}

function LevelSelect({ value, label, disabled, onChange }: { value: string; label: string; disabled?: boolean; onChange: (level: RepoAccessLevel) => void }) {
  const { t } = useTranslation()
  const known = (LEVELS as string[]).includes(value)
  return (
    <select value={value} aria-label={label} disabled={disabled} className="input-field py-0.5 text-xs w-auto" onChange={e => onChange(e.target.value as RepoAccessLevel)}>
      {/* Niveau propre à la forge (triage, maintain) : affiché tel quel, pas proposé. */}
      {!known && <option value={value} disabled>{value}</option>}
      {LEVELS.map(l => <option key={l} value={l}>{t(`repoWizard.members.level.${l}`)}</option>)}
    </select>
  )
}

const levelLabel = (t: (k: string) => string, level: string) => (LEVELS as string[]).includes(level) ? t(`repoWizard.members.level.${level}`) : level

function MembersSection({ repoPath, settings, queryKey }: SectionProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isAdmin = settings.details.permissions.admin
  const [login, setLogin] = useState('')
  const [level, setLevel] = useState<RepoAccessLevel>('write')
  const [team, setTeam] = useState('')
  const [teamLevel, setTeamLevel] = useState<RepoAccessLevel>('write')
  const [busy, setBusy] = useState(false)
  // Erreur affichée sur la ligne de l'action (design §2) ; `add`, `addTeam` : formulaires d'ajout.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmSelf, setConfirmSelf] = useState(false)

  const act = async (key: string, op: () => Promise<void>) => {
    setBusy(true)
    setFailure(null)
    setNotice(null)
    try {
      await op()
    } catch (err) {
      setFailure({ key, message: messageOf(err) })
    } finally {
      setBusy(false)
      await qc.invalidateQueries({ queryKey })
    }
  }
  const rowError = (key: string) => failure?.key === key && <p className="text-xs text-status-danger whitespace-pre-line pl-1">{failure.message}</p>

  const add = () => act('add', async () => {
    const name = login.trim()
    const outcome = await api.forge.setCollaborator(repoPath, name, level)
    setLogin('')
    if (outcome === 'invited') setNotice(t('repoSettings.invited', { login: name }))
  })
  const remove = (who: string) => act(`user:${who}`, () => api.forge.removeCollaborator(repoPath, who))
  const self = settings.collaborators.find(c => c.login.toLowerCase() === settings.login.toLowerCase())
  const freeTeams = settings.orgTeams.filter(o => !settings.teams.some(tm => tm.name === o.name))

  const collaboratorRow = (c: ForgeCollaborator) => {
    const isSelf = c === self
    return (
      <li key={c.login} className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate"><span className="font-mono">{c.login}</span>{c.name && <span className="text-ink-3"> — {c.name}</span>}</span>
          {isAdmin ? (
            <>
              <LevelSelect value={c.level} label={t('repoWizard.members.levelOf', { name: c.login })} disabled={busy}
                onChange={l => void act(`user:${c.login}`, async () => { await api.forge.setCollaborator(repoPath, c.login, l) })} />
              <button type="button" disabled={busy} aria-label={t('repoWizard.members.remove', { name: c.login })} className="text-ink-3 hover:text-status-danger"
                onClick={() => { if (isSelf && c.level === 'admin') setConfirmSelf(true); else void remove(c.login) }}>
                <X size={14} />
              </button>
            </>
          ) : <span className="text-xs text-ink-3">{levelLabel(t, c.level)}</span>}
        </div>
        {rowError(`user:${c.login}`)}
        {isSelf && confirmSelf && (
          <div role="alertdialog" aria-label={t('repoSettings.removeSelf')} className="border border-status-warning-border bg-status-warning-bg rounded p-3 space-y-2 text-sm">
            <p>{t('repoSettings.removeSelf')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmSelf(false)}>{t('common.cancel')}</button>
              <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => { setConfirmSelf(false); void remove(c.login) }}>{t('repoSettings.removeSelfConfirm')}</button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const teamRow = (tm: ForgeRepoTeam) => (
    <li key={tm.name} className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1 truncate">{tm.label}</span>
        {isAdmin && tm.levelEditable
          ? <LevelSelect value={tm.level} label={t('repoWizard.members.levelOf', { name: tm.label })} disabled={busy}
            onChange={l => void act(`team:${tm.name}`, () => api.forge.setRepoTeam(repoPath, tm.name, l))} />
          : <span className="text-xs text-ink-3">{levelLabel(t, tm.level)}</span>}
        {isAdmin && tm.removable && (
          <button type="button" disabled={busy} aria-label={t('repoWizard.members.remove', { name: tm.label })} className="text-ink-3 hover:text-status-danger"
            onClick={() => void act(`team:${tm.name}`, () => api.forge.removeRepoTeam(repoPath, tm.name))}>
            <X size={14} />
          </button>
        )}
      </div>
      {rowError(`team:${tm.name}`)}
    </li>
  )

  return (
    <section className="space-y-3" aria-label={t('repoSettings.members')}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t('repoSettings.members')}</h3>
      {settings.membersRestricted && <p className="text-xs text-ink-3">{t('repoSettings.restricted')}</p>}

      <div className="space-y-2">
        <p className="text-xs text-ink-2">{t('repoSettings.collaborators')}</p>
        {settings.collaborators.length === 0 && !settings.membersRestricted && <p className="text-xs text-ink-3">{t('repoSettings.noCollaborator')}</p>}
        <ul className="space-y-1" aria-label={t('repoSettings.collaborators')}>{settings.collaborators.map(collaboratorRow)}</ul>
        {isAdmin && (
          <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); if (login.trim()) void add() }}>
            <input value={login} onChange={e => setLogin(e.target.value)} list="repo-settings-members" placeholder={t('repoWizard.members.loginPlaceholder')}
              aria-label={t('repoWizard.members.login')} className="input-field flex-1 text-sm py-1" />
            <datalist id="repo-settings-members">
              {settings.orgMembers.map(m => <option key={m.login} value={m.login}>{m.name}</option>)}
            </datalist>
            <LevelSelect value={level} label={t('repoWizard.members.level.label')} onChange={setLevel} />
            <button type="submit" className="btn-secondary btn-sm" disabled={busy || !login.trim()}>{t('repoWizard.members.add')}</button>
          </form>
        )}
        {rowError('add')}
        {notice && <p className="text-xs text-ink-2">{notice}</p>}
      </div>

      {settings.invitations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-ink-2">{t('repoSettings.invitations')}</p>
          <ul className="space-y-1" aria-label={t('repoSettings.invitations')}>
            {settings.invitations.map(i => (
              <li key={i.id} className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate font-mono">{i.login}</span>
                  <span className="text-xs text-ink-3">{levelLabel(t, i.level)}</span>
                  {isAdmin && (
                    <button type="button" className="btn-secondary btn-sm" disabled={busy}
                      onClick={() => void act(`invitation:${i.id}`, () => api.forge.cancelInvitation(repoPath, i.id))}>
                      {t('repoSettings.cancelInvitation')}
                    </button>
                  )}
                </div>
                {rowError(`invitation:${i.id}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {settings.isOrg && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink-2">{t('repoSettings.teams')}</p>
            <a href={settings.teamsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-ink-2 underline hover:text-ink inline-flex items-center gap-1">
              {t('repoSettings.manageTeams')} <ExternalLink size={11} />
            </a>
          </div>
          {settings.scopeMissing && <p className="text-xs text-ink-3">{t('repoSettings.scopeMissing', { host: settings.host })}</p>}
          {!settings.teamLevelEditable && <p className="text-xs text-ink-3">{t('repoSettings.teamLevelOnForge')}</p>}
          {settings.teams.length === 0 && !settings.membersRestricted && <p className="text-xs text-ink-3">{t('repoSettings.noTeam')}</p>}
          <ul className="space-y-1" aria-label={t('repoSettings.teams')}>{settings.teams.map(teamRow)}</ul>
          {isAdmin && freeTeams.length > 0 && (
            <div className="flex items-center gap-2">
              <select value={team} onChange={e => setTeam(e.target.value)} aria-label={t('repoWizard.members.team')} className="input-field flex-1 text-sm py-1">
                <option value="">{t('repoWizard.members.teamPlaceholder')}</option>
                {freeTeams.map(o => <option key={o.name} value={o.name}>{o.label}</option>)}
              </select>
              {settings.teamLevelEditable && <LevelSelect value={teamLevel} label={t('repoWizard.members.level.label')} onChange={setTeamLevel} />}
              <button type="button" className="btn-secondary btn-sm" disabled={busy || !team}
                onClick={() => void act('addTeam', async () => {
                  await api.forge.setRepoTeam(repoPath, team, settings.teamLevelEditable ? teamLevel : undefined)
                  setTeam('')
                })}>
                {t('repoWizard.members.addTeam')}
              </button>
            </div>
          )}
          {rowError('addTeam')}
        </div>
      )}
    </section>
  )
}
