import { useState } from 'react'

interface Props {
  repoLabel: string
  isRemoving: boolean
  error: string | null
  onConfirm: (deleteLocalFolder: boolean) => void
  onClose: () => void
}

export function RemoveDependencyModal({ repoLabel, isRemoving, error, onConfirm, onClose }: Props) {
  const [deleteLocalFolder, setDeleteLocalFolder] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">Retirer {repoLabel} ?</h2>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-ink-2">
            Retire {repoLabel} de l'arbre du workspace (référence retirée de{' '}
            <code className="text-ink-3">polenta-repo.yaml</code>).
          </p>
          <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteLocalFolder}
              onChange={e => setDeleteLocalFolder(e.target.checked)}
            />
            Supprimer aussi le dossier local (irréversible)
          </label>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge">
          <button type="button" onClick={onClose} disabled={isRemoving} className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors disabled:opacity-50">
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteLocalFolder)}
            disabled={isRemoving}
            className="text-sm px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
          >
            {isRemoving ? 'Retrait…' : 'Retirer'}
          </button>
        </div>
      </div>
    </div>
  )
}
