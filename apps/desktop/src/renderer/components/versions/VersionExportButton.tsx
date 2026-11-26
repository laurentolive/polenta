import type { VersionPage } from '@polenta/types'
import { ExportButton } from '../export/ExportButton'
import { useVersionExport } from './useVersionExport'

/**
 * GH439 §5 — « Exporter » de la barre de titre d'une version : export global de la page (sections au choix),
 * Excel (une feuille par section) ou PDF (A4 paysage). Remplace le bouton Exporter de chaque grille de la page.
 */
export function VersionExportButton({ page, repoPath, projectId, versionId }: { page: VersionPage; repoPath: string; projectId: string; versionId: string }) {
  const { choices, getSuggestedBaseName, getPayload, getPrintParams } = useVersionExport({ page, repoPath, projectId, versionId })
  return (
    <ExportButton
      kind="version"
      formats={['xlsx', 'pdf']}
      repoPath={repoPath}
      getSuggestedBaseName={getSuggestedBaseName}
      getPayload={getPayload}
      getPrintParams={getPrintParams}
      choices={choices}
    />
  )
}
