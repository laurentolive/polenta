import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { FileDown, FileSpreadsheet, FileUp } from 'lucide-react'
import type { ExecutionImportPreview, ExecutionSheetLocale, ExportResult } from '@polenta/types'
import { api } from '../../api'
import { ExecutionImportModal } from './ExecutionImportModal'

interface ExecutionSheetMenuProps {
  repoPath: string
  campaignId: string
  workspaceDir?: string
}

/** Langue des libellés du classeur : celle de l'UI (le réimport reconnaît les deux). */
function sheetLocale(language: string | undefined): ExecutionSheetLocale {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'fr'
}

/**
 * GH36 — exécution d'une campagne hors outil : bouton « Excel d'exécution » du header de la page
 * campagne (popover d'actions). Masqué par l'appelant pour une campagne clôturée.
 */
export function ExecutionSheetMenu({ repoPath, campaignId, workspaceDir }: ExecutionSheetMenuProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<ExecutionImportPreview | null>(null)

  const exportMutation = useMutation({
    mutationFn: (): Promise<ExportResult> =>
      api.campaigns.executionSheet.export(repoPath, campaignId, sheetLocale(i18n.language)),
    onSuccess: result => {
      setOpen(false)
      if (result.status === 'error') setError(result.message)
      if (result.status === 'ok') setSavedPath(result.filePath)
    },
    onError: (err: unknown) => {
      setOpen(false)
      setError(err instanceof Error ? err.message : t('exportButton.exportError'))
    },
  })

  const previewMutation = useMutation({
    mutationFn: () => api.campaigns.executionSheet.preview(repoPath, campaignId),
    onSuccess: result => {
      setOpen(false)
      // Sélecteur de fichier fermé sans choix : rien à afficher.
      if (!('canceled' in result)) setImportPreview(result)
    },
    onError: (err: unknown) => {
      setOpen(false)
      setError(err instanceof Error ? err.message : t('common.unknownError'))
    },
  })
  const busy = exportMutation.isPending || previewMutation.isPending

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-secondary-sm flex items-center gap-1.5"
        title={t('campaignPage.executionSheet.menuTitle')}
      >
        <FileSpreadsheet size={13} />
        {t('campaignPage.executionSheet.menu')}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-1 w-64 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => exportMutation.mutate()}
              disabled={busy}
              className="flex items-start gap-2 px-3 py-2 rounded hover:bg-hover text-left disabled:opacity-50"
            >
              <FileDown size={15} className="mt-0.5 shrink-0 text-ink-2" />
              <span>
                <span className="block text-xs text-ink">{t('campaignPage.executionSheet.export')}</span>
                <span className="block text-[11px] text-ink-3">{t('campaignPage.executionSheet.exportHint')}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => previewMutation.mutate()}
              disabled={busy}
              className="flex items-start gap-2 px-3 py-2 rounded hover:bg-hover text-left disabled:opacity-50"
            >
              <FileUp size={15} className="mt-0.5 shrink-0 text-ink-2" />
              <span>
                <span className="block text-xs text-ink">{t('campaignPage.executionSheet.import')}</span>
                <span className="block text-[11px] text-ink-3">{t('campaignPage.executionSheet.importHint')}</span>
              </span>
            </button>
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
            <p className="text-xs text-status-danger mb-2">{error}</p>
            <button type="button" onClick={() => setError(null)} className="btn-secondary-sm">
              {t('common.close')}
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
            <p className="text-xs text-ink-2 mb-2 break-all">{t('exportButton.exportedTo', { path: savedPath })}</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => api.export.showInFolder(savedPath)} className="btn-secondary-sm">
                {t('exportButton.openFolder')}
              </button>
              <button type="button" onClick={() => api.export.openFile(savedPath)} className="btn-secondary-sm">
                {t('exportButton.openFile')}
              </button>
              <button type="button" onClick={() => setSavedPath(null)} className="btn-secondary-sm">
                {t('common.close')}
              </button>
            </div>
          </div>
        </>
      )}

      {importPreview && (
        <ExecutionImportModal
          repoPath={repoPath}
          campaignId={campaignId}
          workspaceDir={workspaceDir}
          preview={importPreview}
          onClose={() => setImportPreview(null)}
        />
      )}
    </div>
  )
}
