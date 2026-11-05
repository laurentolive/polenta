import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { AddRepoWizard } from './AddRepoWizard'

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
  const [created, setCreated] = useState<string | null>(null)
  if (accounts.length === 0) return null

  return (
    <div className="text-xs">
      {created && <p className="text-status-success mb-1">{t('schema.addDependency.server.created', { repo: created })}</p>}
      <button type="button" onClick={() => setOpen(true)} className="text-ink-2 underline hover:text-ink">
        {t('schema.addDependency.server.create')}
      </button>
      {open && (
        // Échap et Entrée restent dans l'assistant : la fenêtre d'ajout ne doit ni se fermer ni se valider.
        <div onKeyDown={e => {
          if (e.key !== 'Escape' && e.key !== 'Enter') return
          e.stopPropagation()
          if (e.key === 'Escape') setOpen(false)
        }}>
          <AddRepoWizard mode="component" accounts={accounts} initialName={suggestedName}
            onSubmit={req => api.forge.createRepo({ ...req, target: { kind: 'component' } })}
            onDone={result => {
              setOpen(false)
              setCreated(result.fullName)
              onCreated(result.cloneUrl, result.branch)
            }}
            onCancel={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
