import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { isValidIntegrationSuffix, type AdoptRepoRequest, type CreateRepoResult, type ForgeAccount, type RepoInspection } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { AddRepoWizard, ProvisionResult } from './AddRepoWizard'

export interface ExistingRepoTarget {
  accountKey: string
  owner: string
  name: string
}

export type AdoptAnswers = Omit<AdoptRepoRequest, 'target'>

interface Props {
  mode: 'project' | 'component'
  accounts: ForgeAccount[]
  repo: ExistingRepoTarget
  /** Adopte le repo (cible choisie par l'appelant). `null` : annulé. Une erreur levée est affichée. */
  onAdopt: (answers: AdoptAnswers) => Promise<CreateRepoResult | null>
  /** « Ouvrir tel quel » : clone, sans rien écrire sur le serveur. `null` : inspection impossible. */
  onAsIs: (inspection: RepoInspection | null) => void
  onDone: (result: CreateRepoResult) => void
  onCancel: () => void
}

/**
 * GH107 — « Ajouter un repo », repo existant (spec GH103 §2.3, design §4 et §5) : Polenta inspecte le
 * repo et ne demande que ce qui manque. Repo vide : formulaire complet. Repo complet : aucune question.
 * Décision de l'humain (2026-11-05) : un repo déjà projet Polenta n'est jamais forcé — ce qui manque
 * est proposé, avec « Ouvrir tel quel », et il s'ouvre sans question en lecture seule.
 */
export function AddExistingRepo({ mode, accounts, repo, onAdopt, onAsIs, onDone, onCancel }: Props) {
  const { t } = useTranslation()
  const { data: found, error, isLoading } = useQuery({
    queryKey: ['forge-inspect-repo', repo.accountKey, repo.owner, repo.name],
    queryFn: () => api.forge.inspectRepo(repo.accountKey, repo.owner, repo.name),
    retry: false,
    gcTime: 0,
  })
  const [suffix, setSuffix] = useState(repo.name)
  const [description, setDescription] = useState<string | null>(null)
  const [confirmInit, setConfirmInit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [result, setResult] = useState<CreateRepoResult | null>(null)

  const adopt = async (answers: Omit<AdoptAnswers, 'accountKey' | 'owner' | 'name'>) => {
    setBusy(true)
    setFailure(null)
    try {
      const adopted = await onAdopt({ accountKey: repo.accountKey, owner: repo.owner, name: repo.name, ...answers })
      if (!adopted) {
        // Choix du dossier annulé : sans question à l'écran, plus rien à montrer.
        if (silent) onCancel()
        return
      }
      if (adopted.steps.every(s => s.status === 'done')) onDone(adopted)
      else setResult(adopted)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const canPush = found?.details.permissions.push ?? false
  const refused = !!found && !canPush && (found.empty || !found.isPolentaProject)
  // Rien à demander : repo complet, ou projet Polenta en lecture seule. Une seule fois.
  const silent = !!found && !found.empty && !refused && (found.missing.length === 0 || !canPush)
  const started = useRef(false)
  useEffect(() => {
    if (!silent || started.current) return
    started.current = true
    void adopt({})
    // `adopt` change à chaque rendu : l'adoption silencieuse ne part qu'une fois, gardée par `started`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silent])

  useModalHotkeys(onCancel, undefined, busy)

  if (result) return <ProvisionResult result={result} mode={mode} onContinue={() => onDone(result)} onClose={onCancel} />

  if (found?.empty && canPush) {
    return (
      <AddRepoWizard mode={mode} accounts={accounts}
        existing={{ accountKey: repo.accountKey, owner: repo.owner, name: repo.name, description: found.details.description, visibility: found.details.visibility }}
        onSubmit={req => onAdopt({
          accountKey: repo.accountKey, owner: repo.owner, name: repo.name, integrationSuffix: req.integrationSuffix,
          description: req.description, visibility: req.visibility, members: req.members,
        })}
        onDone={onDone} onCancel={onCancel} />
    )
  }

  const descriptionValue = description ?? found?.details.description ?? ''
  const missing = found?.missing ?? []
  const asksIntegration = missing.includes('integration')
  const asksDescription = missing.includes('description')
  const asksPolenta = missing.includes('polenta')
  const canSubmit = !busy && (!asksIntegration || isValidIntegrationSuffix(suffix))
    && (!asksDescription || !!descriptionValue.trim()) && (!asksPolenta || confirmInit)
  const adminNotes = !!found && !found.details.permissions.admin && canPush

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={busy ? undefined : onCancel}>
      <form aria-label={t('repoWizard.existing.title')} onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault()
          if (!canSubmit) return
          void adopt({
            ...(asksIntegration ? { integrationSuffix: suffix } : {}),
            ...(asksDescription ? { description: descriptionValue.trim() } : {}),
            ...(asksPolenta ? { initPolenta: true } : {}),
          })
        }}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-sm font-semibold text-ink">{t('repoWizard.existing.title')}</h2>
        <p className="text-sm font-mono text-ink-2">{repo.owner}/{repo.name}</p>

        {isLoading && <p className="text-sm text-ink-3">{t('repoWizard.existing.inspecting')}</p>}
        {error && <p className="text-sm text-status-danger">{error instanceof Error ? error.message : String(error)}</p>}
        {silent && busy && <p className="text-sm text-ink-3">{t('repoWizard.existing.adding')}</p>}
        {refused && (
          <p className="text-sm text-status-danger">
            {found!.empty
              ? t('repoWizard.existing.refusedEmpty')
              : t('repoWizard.existing.refused', { missing: missing.map(m => t(`repoWizard.existing.missing.${m}`)).join(', ') })}
          </p>
        )}

        {found && !silent && !refused && (
          <>
            <p className="text-sm text-ink-2">
              {found.isPolentaProject ? t('repoWizard.existing.polentaIncomplete') : t('repoWizard.existing.notPolenta')}
            </p>
            {asksIntegration && (
              <div className="space-y-1">
                <span className="block text-xs text-ink-2">{t('repoWizard.branch')}</span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-sm text-ink-2">int-</span>
                  <input value={suffix} onChange={e => setSuffix(e.target.value)} className="input-field flex-1 font-mono text-sm" aria-label={t('repoWizard.branch')} />
                </div>
                <p className="text-xs text-ink-3">{t('repoWizard.existing.branchHelp', { branch: found.details.defaultBranch })}</p>
                {suffix && !isValidIntegrationSuffix(suffix) && <p className="text-xs text-status-danger">{t('repoWizard.branchInvalid')}</p>}
              </div>
            )}
            {asksDescription && (
              <div className="space-y-1">
                <span className="block text-xs text-ink-2">{t('repoWizard.description')}</span>
                <textarea value={descriptionValue} onChange={e => setDescription(e.target.value)} rows={2} className="input-field w-full" aria-label={t('repoWizard.description')} />
                <p className="text-xs text-ink-3">{t('repoWizard.existing.descriptionHelp')}</p>
              </div>
            )}
            {asksPolenta && (
              <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" className="mt-1" checked={confirmInit} onChange={e => setConfirmInit(e.target.checked)} />
                <span>{t('repoWizard.existing.confirmInit')}</span>
              </label>
            )}
            {adminNotes && <p className="text-xs text-ink-3">{t('repoWizard.existing.adminNote')}</p>}
          </>
        )}

        {failure && <p className="text-sm text-status-danger whitespace-pre-line">{failure}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary" disabled={busy}>{t('common.cancel')}</button>
          {/* Inspection impossible : le clone d'avant reste possible (droit vérifié par la forge). */}
          {(error || (found && !silent && !refused && found.isPolentaProject)) && (
            <button type="button" onClick={() => onAsIs(found ?? null)} className="btn-secondary" disabled={busy}>
              {t('repoWizard.existing.asIs')}
            </button>
          )}
          {found && !silent && !refused && (
            <button type="submit" disabled={!canSubmit} className="btn-primary">
              {busy ? t('repoWizard.existing.adding') : t('repoWizard.existing.complete')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
