import type { TFunction } from 'i18next'
import type { VersionPage } from '@polenta/types'
import { api } from '../../api'
import { gridPrefKeys } from '../grid/useGridPrefs'
import {
  buildVersionSectionTables, VERSION_GRID_PREF_KEYS, VERSION_SECTIONS, type SectionTable, type VersionGridPrefs, type VersionGridSectionId, type VersionSectionId,
} from './versionSectionTables'

/** Clés d'une section reçue d'un paramètre d'URL ou d'une sélection : celles que la page connaît, dans l'ordre de la page. */
export function parseVersionSections(raw: string | readonly string[] | undefined): VersionSectionId[] {
  const wanted = new Set(typeof raw === 'string' ? raw.split(',') : raw ?? [])
  return VERSION_SECTIONS.filter(id => wanted.has(id))
}

const GRID_SECTIONS = Object.keys(VERSION_GRID_PREF_KEYS) as VersionGridSectionId[]
const COLUMN_KEYS = gridPrefKeys('columns')

/** Préférences de colonnes (celles de l'écran) des grilles cochées : colonnes visibles dans l'ordre, largeurs. */
async function loadGridPrefs(repoPath: string, username: string, selected: readonly VersionSectionId[]): Promise<Partial<Record<VersionGridSectionId, VersionGridPrefs>>> {
  const out: Partial<Record<VersionGridSectionId, VersionGridPrefs>> = {}
  await Promise.all(GRID_SECTIONS.filter(id => selected.includes(id)).map(async id => {
    const entry = await api.pref.getFieldVisibility(repoPath, username, VERSION_GRID_PREF_KEYS[id]).catch(() => null) as Record<string, unknown> | null
    const columns = entry?.[COLUMN_KEYS.columns]
    const widths = entry?.[COLUMN_KEYS.widths]
    out[id] = {
      ...(Array.isArray(columns) && columns.every(k => typeof k === 'string') ? { columns: columns as string[] } : {}),
      ...(widths && typeof widths === 'object' ? { widths: widths as Record<string, number> } : {}),
    }
  }))
  return out
}

/**
 * GH439 §5 — lit les données de la page d'une version et construit les tables des sections cochées. Le **même**
 * chemin pour l'export Excel et pour la route imprimable du PDF : mêmes sections, colonnes et lignes. Les données
 * sont relues à l'export (jamais celles d'un écran d'avant), même pour une section repliée.
 */
export async function loadVersionSectionTables(input: {
  repoPath: string
  workspaceDir: string
  versionId: string
  selected: readonly VersionSectionId[]
  username: string
  t: TFunction
  language: string
}): Promise<{ page: VersionPage; tables: SectionTable[] }> {
  const { repoPath, versionId, selected } = input
  const ws = input.workspaceDir || undefined
  const page = await api.versions.get(repoPath, versionId, ws)
  const needsImpact = page.state !== 'abandoned' && selected.some(id => id === 'analysis' || id === 'tests')
  const [impact, requirements, grids] = await Promise.all([
    needsImpact ? api.versions.impact(repoPath, versionId, ws) : undefined,
    selected.includes('requirements') ? api.versions.requirements(repoPath, versionId, ws) : undefined,
    loadGridPrefs(repoPath, input.username, selected),
  ])
  return { page, tables: buildVersionSectionTables({ selected, page, impact, requirements, grids, t: input.t, language: input.language }) }
}
