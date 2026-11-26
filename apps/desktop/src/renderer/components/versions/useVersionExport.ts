import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { VersionPage } from '@polenta/types'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { versionExportBaseName } from '../export/exportFilenames'
import { loadVersionSectionTables, parseVersionSections } from './versionExportData'
import { availableVersionSections, toTablesExportPayload, versionSectionLabel } from './versionSectionTables'

/** Mémorisation par poste des sections décochées dans la fenêtre d'export. */
const EXPORT_SECTIONS_KEY = 'polenta:versionExportSections'

/**
 * GH439 §5 — export global de la page d'une version : sections proposées (celles que la page affiche), nom de
 * fichier, données Excel (une feuille par section) et paramètres de la route imprimable du PDF. Les deux formats
 * relisent leurs données par `loadVersionSectionTables`.
 */
export function useVersionExport({ page, repoPath, projectId, versionId }: { page: VersionPage; repoPath: string; projectId: string; versionId: string }) {
  const { t, i18n } = useTranslation()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  const items = useMemo(
    () => availableVersionSections(page).map(id => ({ key: id, label: versionSectionLabel(t, id) })),
    [page, t],
  )
  const choices = useMemo(() => ({ items, storageKey: EXPORT_SECTIONS_KEY, title: t('versions.export.sections') }), [items, t])
  const usernameOf = () => api.auth.projectUsername(repoPath).catch(() => 'local')

  return {
    choices,
    getSuggestedBaseName: () => versionExportBaseName(page.component.label, page.version.title),
    getPayload: async (_format: 'xlsx' | 'docx', { selected }: { templated: boolean; selected?: string[] }) => {
      const { tables } = await loadVersionSectionTables({
        repoPath, workspaceDir, versionId, selected: parseVersionSections(selected), username: await usernameOf(), t, language: i18n.language,
      })
      return toTablesExportPayload(tables)
    },
    getPrintParams: async (selected?: string[]) => ({
      repoPath, workspaceDir, versionId, sections: (selected ?? []).join(','), username: await usernameOf(), language: i18n.language,
    }),
  }
}
