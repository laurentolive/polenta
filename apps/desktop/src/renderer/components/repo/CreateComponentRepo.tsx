import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { ForgeRepo } from '@polenta/types'
import { RepoPickerModal } from '../home/RepoPickerModal'
import { AddRepoWizard } from './AddRepoWizard'
import { AddExistingRepo, type ExistingRepoTarget } from './AddExistingRepo'

interface Props {
  /** Nom proposé pour le repo (nom de montage saisi dans la fenêtre d'ajout). */
  suggestedName: string
  /** URL de clone et branche `int-x` à inscrire dans la fenêtre d'ajout (pin de `polenta-repo.yaml`). */
  onCreated: (cloneUrl: string, branch: string) => void
}

/**
 * GH107 — « Créer le repo sur le serveur » dans l'ajout d'un composant (GH103 §2.1, design §3.3) :
 * l'assistant crée le repo sur GitHub ou Forgejo ; son URL et sa branche d'intégration remplissent
 * la fenêtre d'ajout, qui se poursuit comme pour un repo existant. Absent sans compte éligible.
 */
export function CreateComponentRepo({ suggestedName, onCreated }: Props) {
  const { t } = useTranslation()
  const { data: accounts = [] } = useQuery({ queryKey: ['forge-repo-accounts'], queryFn: () => api.forge.repoAccounts(), retry: false })
  const [open, setOpen] = useState(false)
  // GH107 — repo existant : liste des repos du compte, puis inspection (seul ce qui manque est demandé).
  const [picking, setPicking] = useState(false)
  const [existing, setExisting] = useState<ExistingRepoTarget | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  if (accounts.length === 0) return null

  const close = () => { setOpen(false); setPicking(false); setExisting(null) }
  const pick = (repo: ForgeRepo, accountKey: string) => {
    setPicking(false)
    setExisting({ accountKey, owner: repo.owner, name: repo.name })
  }
  const finished = (fullName: string, cloneUrl: string, branch: string) => {
    close()
    setCreated(fullName)
    onCreated(cloneUrl, branch)
  }

  return (
    <div className="text-xs">
      {created && <p className="text-status-success mb-1">{t('schema.addDependency.server.created', { repo: created })}</p>}
      <button type="button" onClick={() => setOpen(true)} className="text-ink-2 underline hover:text-ink">
        {t('schema.addDependency.server.create')}
      </button>
      <button type="button" onClick={() => setPicking(true)} className="text-ink-2 underline hover:text-ink ml-3">
        {t('schema.addDependency.server.fromExisting')}
      </button>
      {(open || picking || existing) && (
        // Échap et Entrée restent dans l'assistant : la fenêtre d'ajout ne doit ni se fermer ni se valider.
        <div onKeyDown={e => {
          if (e.key !== 'Escape' && e.key !== 'Enter') return
          e.stopPropagation()
          if (e.key === 'Escape') close()
        }}>
          {open && (
            <AddRepoWizard mode="component" accounts={accounts} initialName={suggestedName}
              onSubmit={req => api.forge.createRepo({ ...req, target: { kind: 'component' } })}
              onDone={result => finished(result.fullName, result.cloneUrl, result.branch)}
              onCancel={close} />
          )}
          {picking && <RepoPickerModal accounts={accounts} onPick={pick} onEnterUrl={close} onCancel={close} />}
          {existing && (
            <AddExistingRepo mode="component" accounts={accounts} repo={existing}
              onAdopt={answers => api.forge.adoptRepo({ ...answers, target: { kind: 'component' } })}
              onDone={result => finished(result.fullName, result.cloneUrl, result.branch)}
              onAsIs={found => { if (found) finished(found.fullName, found.details.cloneUrl, found.integration?.branch ?? found.details.defaultBranch); else close() }}
              onCancel={close} />
          )}
        </div>
      )}
    </div>
  )
}
