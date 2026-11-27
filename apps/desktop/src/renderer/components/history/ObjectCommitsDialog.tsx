/**
 * GH446 — popup « Historique » d'un objet : les commits qui modifient son fichier (liste à gauche), le diff de
 * ce fichier au commit choisi (à droite, `FileDiffView` : Brut / Rendu au choix, préférence globale `diffPrefs`).
 * Lecture seule : le diff d'un commit a pour `newRef` son SHA, donc `FileDiffView` n'affiche aucune action
 * d'enregistrement. Aucun diff n'est lu avant une sélection (critère 15).
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { objectHistoryFile, type ObjectCommitKind } from '@polenta/types'
import { api } from '../../api'
import { backdropDismiss } from '../../lib/backdropDismiss'
import { FileDiffView } from '../diff/FileDiffView'

export interface ObjectCommitsTarget {
  kind: ObjectCommitKind
  id: string
  /** Libellé de l'objet dans la popup (titre ou ID). */
  title: string
}

export function ObjectCommitsDialog({ repoPath, target, onClose }: {
  repoPath: string
  target: ObjectCommitsTarget
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const [sha, setSha] = useState<string | null>(null)
  const filepath = objectHistoryFile(target.kind, target.id)

  const commits = useQuery({
    queryKey: ['object-commits', repoPath, target.kind, target.id],
    queryFn: () => api.history.commits(repoPath, target.kind, target.id),
  })
  // Même clé que l'écran Diff : le diff déjà lu n'est pas relu.
  const diff = useQuery({
    queryKey: ['sync:commit-diff', repoPath, sha, filepath],
    queryFn: () => api.sync.commitDiff(repoPath, sha!, filepath),
    enabled: !!sha,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const list = commits.data ?? []
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" {...backdropDismiss(onClose)}>
      <div
        role="dialog" aria-modal="true" aria-label={t('history.commits.title', { title: target.title })}
        data-testid="object-commits-dialog"
        /* Un clic dans la popup ne doit pas arriver au fond (`backdropDismiss` ferme sur un clic « de fond »). */
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-edge rounded-lg shadow-xl w-[min(96vw,1200px)] h-[80vh] flex flex-col"
      >
        <header className="flex items-center gap-3 px-4 py-2 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink truncate flex-1">{t('history.commits.title', { title: target.title })}</h2>
          <span className="font-mono text-xs text-ink-3 truncate">{filepath}</span>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="p-1 rounded hover:bg-hover text-ink-3">
            <X size={14} />
          </button>
        </header>
        <div className="flex flex-1 min-h-0">
          <div className="w-80 shrink-0 border-r border-edge overflow-y-auto" data-testid="object-commits-list">
            {commits.isLoading && <p className="p-4 text-xs text-ink-3 italic">{t('common.loading')}</p>}
            {commits.isError && <p className="p-4 text-xs text-status-danger">{t('history.commits.error')}</p>}
            {!commits.isLoading && !commits.isError && list.length === 0 && (
              <p className="p-4 text-xs text-ink-3 italic" data-testid="object-commits-none">{t('history.commits.none')}</p>
            )}
            <ul>
              {list.map(c => (
                <li key={c.oid}>
                  <button
                    type="button"
                    aria-pressed={sha === c.oid}
                    data-testid="object-commit-row"
                    data-sha={c.oid}
                    onClick={() => setSha(c.oid)}
                    className={`w-full text-left px-4 py-2 border-b border-edge-subtle text-xs ${sha === c.oid ? 'bg-hover text-prim' : 'text-ink-2 hover:bg-hover'}`}
                  >
                    <span className="block text-ink-3">{new Date(c.at).toLocaleString(i18n.language)} · {c.by}</span>
                    <span className="block truncate text-ink">{c.subject}</span>
                    <span className="block font-mono text-ink-3">{c.oid.slice(0, 7)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex-1 min-w-0 flex flex-col" data-testid="object-commit-diff">
            {sha
              ? <FileDiffView repoPath={repoPath} filepath={filepath} contents={diff.data} isLoading={diff.isLoading} showPath={false} />
              : <p className="p-6 text-xs text-ink-3 italic">{t('history.commits.selectOne')}</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Ouverture de la popup depuis un panneau : `open(kind, id, title)` et `dialog` à rendre dans le composant. */
export function useObjectCommitsDialog(repoPath: string) {
  const [target, setTarget] = useState<ObjectCommitsTarget | null>(null)
  const dialog = target
    ? <ObjectCommitsDialog repoPath={repoPath} target={target} onClose={() => setTarget(null)} />
    : null
  return { open: (kind: ObjectCommitKind, id: string, title: string) => setTarget({ kind, id, title }), dialog }
}
