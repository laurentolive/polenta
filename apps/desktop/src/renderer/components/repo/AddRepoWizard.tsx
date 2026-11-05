import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleSlash, ShieldAlert, XCircle } from 'lucide-react'
import {
  isValidIntegrationSuffix,
  type CreateRepoRequest, type CreateRepoResult, type ForgeAccount, type ForgeOwner, type RepoMemberGrant, type RepoVisibility,
} from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { RepoMembersEditor } from './RepoMembersEditor'

/** Nom accepté par Forgejo et GitHub sans transformation (même règle que `assertRepoName`). */
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/
const isValidRepoName = (name: string) => REPO_NAME.test(name) && !name.startsWith('.') && !name.startsWith('-')

export type NewRepoRequest = Omit<CreateRepoRequest, 'target'>

interface Props {
  mode: 'project' | 'component'
  /** Comptes GitHub et Forgejo connectés (au moins un). */
  accounts: ForgeAccount[]
  initialName?: string
  /** GH107 — repo existant vide : compte, propriétaire et nom imposés, reste pré-rempli depuis la forge. */
  existing?: { accountKey: string; owner: string; name: string; description: string; visibility: RepoVisibility }
  /**
   * Crée le repo (cible choisie par l'appelant : dossier du projet ou composant). `null` : annulé
   * (choix du dossier). Une erreur levée est affichée, le formulaire reste modifiable.
   */
  onSubmit: (req: NewRepoRequest) => Promise<CreateRepoResult | null>
  /** Création terminée sans échec, ou « Continuer » après un échec partiel. */
  onDone: (result: CreateRepoResult) => void
  onCancel: () => void
}

/**
 * GH107 — assistant « Ajouter un repo », mode Nouveau repo (spec GH103 §2.2, design §5) : service,
 * propriétaire, nom (disponibilité vérifiée à la pause de frappe), visibilité, description,
 * branche d'intégration `int-*`, membres. Le bouton reste désactivé tant que le critère 2 du §2.4
 * n'est pas rempli. Après un échec partiel, la liste des étapes est affichée.
 */
export function AddRepoWizard({ mode, accounts, initialName = '', existing, onSubmit, onDone, onCancel }: Props) {
  const { t } = useTranslation()
  const [accountKey, setAccountKey] = useState(existing?.accountKey ?? accounts[0].key)
  const [owner, setOwner] = useState(existing?.owner ?? '')
  const [name, setName] = useState(existing?.name ?? initialName)
  const [visibility, setVisibility] = useState<RepoVisibility>(existing?.visibility ?? 'private')
  const [description, setDescription] = useState(existing?.description ?? '')
  // Branche pré-remplie avec le nom, tant que l'utilisateur ne l'a pas modifiée.
  const [suffix, setSuffix] = useState<string | null>(null)
  const [members, setMembers] = useState<RepoMemberGrant[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateRepoResult | null>(null)

  const account = accounts.find(a => a.key === accountKey) ?? accounts[0]
  const ownersQuery = useQuery({
    queryKey: ['forge-owners', accountKey],
    queryFn: () => api.forge.owners(accountKey),
    retry: false,
  })
  const owners = ownersQuery.data?.owners ?? NO_OWNERS
  // Repo existant : le propriétaire peut ne pas être de ceux où le compte peut créer.
  const current = owners.find(o => o.name === owner)
    ?? (existing ? { name: existing.owner, label: '', kind: existing.owner === account.login ? 'user' as const : 'org' as const, canCreate: true as const } : undefined)
  useEffect(() => {
    if (!existing && owners.length > 0 && !owners.some(o => o.name === owner)) setOwner(owners[0].name)
  }, [owners, owner, existing])

  const trimmed = name.trim()
  const branchSuffix = suffix ?? trimmed
  const nameValid = isValidRepoName(trimmed)
  const availability = useNameAvailability(accountKey, owner, nameValid && !existing ? trimmed : '')
  const branchValid = isValidIntegrationSuffix(branchSuffix)
  const canSubmit = !busy && !!current && nameValid && (!!existing || availability === 'free') && !!description.trim() && branchValid

  useModalHotkeys(onCancel, undefined, busy)

  const submit = async () => {
    if (!canSubmit || !current) return
    setBusy(true)
    setError(null)
    try {
      const created = await onSubmit({
        accountKey, owner: current.name, ownerKind: current.kind, name: trimmed, description: description.trim(), visibility,
        integrationSuffix: branchSuffix, members,
      })
      if (!created) return
      if (created.steps.every(s => s.status === 'done')) onDone(created)
      else setResult(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (result) return <ProvisionResult result={result} mode={mode} onContinue={() => onDone(result)} onClose={onCancel} />

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={busy ? undefined : onCancel}>
      <form onSubmit={e => { e.preventDefault(); void submit() }} onClick={e => e.stopPropagation()} aria-label={t('repoWizard.title')}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-sm font-semibold text-ink">
          {existing ? t('repoWizard.existing.titleEmpty') : mode === 'project' ? t('repoWizard.titleProject') : t('repoWizard.titleComponent')}
        </h2>

        {existing && <p className="text-sm font-mono text-ink-2">{existing.owner}/{existing.name}</p>}

        {!existing && accounts.length > 1 && (
          <Field label={t('repoWizard.account')}>
            <select value={accountKey} onChange={e => { setAccountKey(e.target.value); setOwner(''); setMembers([]) }} className="input-field w-full"
              aria-label={t('repoWizard.account')}>
              {accounts.map(a => <option key={a.key} value={a.key}>{a.login} — {a.host}</option>)}
            </select>
          </Field>
        )}

        {!existing && <Field label={t('repoWizard.owner')}>
          <select value={owner} onChange={e => { setOwner(e.target.value); setMembers([]) }} className="input-field w-full"
            aria-label={t('repoWizard.owner')} disabled={owners.length === 0}>
            {owners.map(o => (
              <option key={o.name} value={o.name}>
                {o.kind === 'user' ? t('repoWizard.ownerSelf', { login: o.name }) : o.label ? `${o.name} — ${o.label}` : o.name}
              </option>
            ))}
          </select>
          {ownersQuery.isLoading && <p className="text-xs text-ink-3">{t('common.loading')}</p>}
          {ownersQuery.error && <p className="text-xs text-status-danger">{messageOf(ownersQuery.error)}</p>}
          {ownersQuery.data?.scopeMissing && <p className="text-xs text-ink-3">{t('repoWizard.scopeMissing', { host: account.host })}</p>}
          {current?.canCreate === 'unknown' && <p className="text-xs text-ink-3">{t('repoWizard.ownerRightUnknown', { owner: current.name })}</p>}
        </Field>}

        {!existing && <Field label={t('repoWizard.name')}>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus className="input-field w-full" aria-label={t('repoWizard.name')} />
          {trimmed && !nameValid && <p className="text-xs text-status-danger">{t('repoWizard.nameInvalid')}</p>}
          {nameValid && availability === 'checking' && <p className="text-xs text-ink-3">{t('repoWizard.nameChecking')}</p>}
          {nameValid && availability === 'taken' && <p className="text-xs text-status-danger">{t('repoWizard.nameTaken', { repo: `${owner}/${trimmed}` })}</p>}
          {nameValid && availability === 'free' && <p className="text-xs text-status-success">{t('repoWizard.nameFree')}</p>}
          {typeof availability === 'object' && <p className="text-xs text-status-danger">{availability.error}</p>}
        </Field>}

        <fieldset className="space-y-1">
          <legend className="text-xs text-ink-2">{t('repoWizard.visibility')}</legend>
          <div className="flex gap-4 text-sm">
            {(['private', 'public'] as const).map(v => (
              <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="visibility" checked={visibility === v} onChange={() => setVisibility(v)} />
                {t(`repoWizard.${v}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label={t('repoWizard.description')}>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="input-field w-full"
            aria-label={t('repoWizard.description')} />
          <p className="text-xs text-ink-3">{t('repoWizard.descriptionHelp')}</p>
        </Field>

        <Field label={t('repoWizard.branch')}>
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm text-ink-2">int-</span>
            <input value={branchSuffix} onChange={e => setSuffix(e.target.value)} className="input-field flex-1 font-mono text-sm"
              aria-label={t('repoWizard.branch')} />
          </div>
          {branchSuffix && !branchValid && <p className="text-xs text-status-danger">{t('repoWizard.branchInvalid')}</p>}
        </Field>

        {current && (
          <Field label={t('repoWizard.members.title')}>
            <RepoMembersEditor accountKey={accountKey} owner={current.name} ownerKind={current.kind} value={members} onChange={setMembers} />
          </Field>
        )}

        {error && <p className="text-sm text-status-danger whitespace-pre-line">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary" disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" disabled={!canSubmit} className="btn-primary">
            {busy ? t('repoWizard.creating') : existing ? t('repoWizard.existing.fill') : t('repoWizard.create')}
          </button>
        </div>
      </form>
    </div>
  )
}

const NO_OWNERS: ForgeOwner[] = []

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-ink-2">{label}</span>
      {children}
    </div>
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type Availability = 'idle' | 'checking' | 'free' | 'taken' | { error: string }

/** Disponibilité du nom, vérifiée 400 ms après la dernière frappe ; le résultat d'une frappe dépassée est ignoré. */
function useNameAvailability(accountKey: string, owner: string, name: string): Availability {
  const [state, setState] = useState<Availability>('idle')
  const seq = useRef(0)
  useEffect(() => {
    const id = ++seq.current
    if (!owner || !name) { setState('idle'); return }
    setState('checking')
    const timer = setTimeout(() => {
      api.forge.nameAvailable(accountKey, owner, name)
        .then(free => { if (seq.current === id) setState(free ? 'free' : 'taken') })
        .catch(err => { if (seq.current === id) setState({ error: messageOf(err) }) })
    }, 400)
    return () => clearTimeout(timer)
  }, [accountKey, owner, name])
  return state
}

/** Étapes après un échec partiel (spec GH103 §2.2) ou un point à faire par un administrateur (§2.3). */
export function ProvisionResult({ result, mode, onContinue, onClose }: {
  result: CreateRepoResult; mode: 'project' | 'component'; onContinue: () => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const canContinue = mode === 'project' ? !!result.open : result.steps.find(s => s.id === 'push')?.status === 'done'
  const incomplete = result.steps.some(s => s.status === 'failed')
  useModalHotkeys(onClose)
  const steps = useMemo(() => result.steps, [result])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={incomplete ? t('repoWizard.result.title') : t('repoWizard.result.titleTodo')}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 space-y-3">
        <h2 className="text-sm font-semibold text-ink">{incomplete ? t('repoWizard.result.title') : t('repoWizard.result.titleTodo')}</h2>
        <p className="text-sm text-ink-2">{t('repoWizard.result.created', { repo: result.fullName, branch: result.branch })}</p>
        <ul className="space-y-1.5" aria-label={t('repoWizard.result.steps')}>
          {steps.map(s => (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              {s.status === 'done' ? <CheckCircle2 size={16} className="text-status-success mt-0.5 shrink-0" />
                : s.status === 'failed' ? <XCircle size={16} className="text-status-danger mt-0.5 shrink-0" />
                  : s.status === 'admin' ? <ShieldAlert size={16} className="text-status-warning mt-0.5 shrink-0" />
                    : <CircleSlash size={16} className="text-ink-3 mt-0.5 shrink-0" />}
              <span>
                <span className="block">{t(`repoWizard.step.${s.id}`)} — {t(`repoWizard.status.${s.status}`)}</span>
                {s.detail && <span className="block text-xs text-ink-3 whitespace-pre-line">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
        {incomplete && <p className="text-xs text-ink-3">{t('repoWizard.result.resume')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.close')}</button>
          {canContinue && <button type="button" onClick={onContinue} className="btn-primary">{t('repoWizard.result.continue')}</button>}
        </div>
      </div>
    </div>
  )
}
