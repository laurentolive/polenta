import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, FileSpreadsheet, FileText, FileType } from 'lucide-react'
import { api } from '../../api'
import type { ExportFormat, ExportKind, ExportResult } from '@polenta/types'

const FORMAT_META: Record<ExportFormat, { label: string; icon: typeof Download; extension: string }> = {
  xlsx: { label: 'Excel', icon: FileSpreadsheet, extension: 'xlsx' },
  docx: { label: 'Word', icon: FileText, extension: 'docx' },
  pdf: { label: 'PDF', icon: FileType, extension: 'pdf' },
}

interface ExportButtonProps {
  kind: ExportKind
  formats: ExportFormat[]
  repoPath: string
  /** Nom de fichier par défaut, sans extension — cf. specs/T43.md §4. Fonction (plutôt qu'une
   *  valeur déjà résolue) pour ne calculer les infos nécessaires (ex. SHA du commit HEAD) qu'à
   *  l'ouverture du popover, pas à chaque rendu de la vue qui héberge ce bouton. */
  getSuggestedBaseName: () => string | Promise<string>
  /** xlsx/docx : données déjà chargées/filtrées côté vue, envoyées telles quelles au main process.
   *  Peut être async (ex. dashboard : exécute les requêtes de chaque widget avant export). Reçoit
   *  le format demandé — nécessaire pour les vues dont la configuration de colonnes diffère entre
   *  Excel et Word (`visibleFieldsExcel`/`visibleFieldsWord` de `SystemView.tsx`). */
  getPayload?: (format: 'xlsx' | 'docx') => unknown | Promise<unknown>
  /** pdf : paramètres transmis à la route imprimable `/print/<kind>`, qui recharge ses propres données. */
  getPrintParams?: () => Record<string, string>
}

/** Bouton "Exporter" partagé, inséré dans le slot `actions` d'un `ViewHeader` — popover listant
 *  les formats disponibles pour la vue (cf. specs/T43-design.md, mapping formats/type). */
export function ExportButton({ kind, formats, repoPath, getSuggestedBaseName, getPayload, getPrintParams }: ExportButtonProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const exportMutation = useMutation({
    mutationFn: async (format: ExportFormat): Promise<ExportResult> => {
      const baseName = await getSuggestedBaseName()
      const suggestedName = `${baseName}.${FORMAT_META[format].extension}`
      if (format === 'pdf') {
        if (!getPrintParams) throw new Error(`Export PDF non disponible pour cette vue`)
        return api.export.save(repoPath, kind, format, undefined, getPrintParams(), suggestedName)
      }
      if (!getPayload) throw new Error(`Export ${FORMAT_META[format].label} non disponible pour cette vue`)
      const payload = await getPayload(format)
      return api.export.save(repoPath, kind, format, payload, undefined, suggestedName)
    },
    onSuccess: (result) => {
      setOpen(false)
      if (result.status === 'error') setError(result.message)
      // `canceled` : l'utilisateur a fermé le dialogue natif — pas d'erreur, pas de confirmation
      // (comportement volontaire, distinct d'un succès silencieux).
      if (result.status === 'ok') setSavedPath(result.filePath)
    },
    onError: (err: unknown) => {
      setOpen(false)
      setError(err instanceof Error ? err.message : 'Erreur lors de l’export')
    },
  })

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-secondary flex items-center gap-1.5 text-xs px-2.5 py-1.5"
        title="Exporter"
      >
        <Download size={13} />
        Exporter
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-2 flex gap-1"
            onClick={e => e.stopPropagation()}
          >
            {formats.map(format => {
              const meta = FORMAT_META[format]
              const Icon = meta.icon
              return (
                <button
                  key={format}
                  type="button"
                  onClick={() => exportMutation.mutate(format)}
                  disabled={exportMutation.isPending}
                  className="flex flex-col items-center gap-1 px-3 py-2 rounded hover:bg-hover text-xs text-ink-2 disabled:opacity-50"
                >
                  <Icon size={18} />
                  {meta.label}
                </button>
              )
            })}
          </div>
        </>
      )}

      {error && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setError(null)} />
          <div
            className="absolute right-0 top-full mt-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-3 w-72"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>
            <button type="button" onClick={() => setError(null)} className="btn-secondary text-xs">
              Fermer
            </button>
          </div>
        </>
      )}

      {savedPath && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSavedPath(null)} />
          <div
            className="absolute right-0 top-full mt-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-3 w-96"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-xs text-ink-2 mb-2 break-all">Exporté vers {savedPath}</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => api.export.showInFolder(savedPath)} className="btn-secondary text-xs">
                Ouvrir le dossier
              </button>
              <button type="button" onClick={() => api.export.openFile(savedPath)} className="btn-secondary text-xs">
                Ouvrir le fichier
              </button>
              <button type="button" onClick={() => setSavedPath(null)} className="btn-secondary text-xs">
                Fermer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
