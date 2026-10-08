import type { HandlerRegistry } from './registry'
import { readPref, writePref } from '../services/pref-store.util'

export function registerPrefHandlers(r: HandlerRegistry) {
  r.handle('pref:get-field-visibility',
    (_e, repoPath: string, username: string, typeKey: string) => {
      const pref = readPref(repoPath, username)
      const visibility = (pref['fieldVisibility'] as Record<string, unknown> | undefined) ?? {}
      return visibility[typeKey] ?? null
    }
  )

  r.handle('pref:set-field-visibility',
    (_e, repoPath: string, username: string, typeKey: string, views: { excel: string[]; word: string[]; edit: string[]; showFoldersExcel?: boolean; showFoldersWord?: boolean; collapsedFoldersExcel?: string[]; collapsedFoldersWord?: string[]; freezeColCountExcel?: number }) => {
      const pref = readPref(repoPath, username)
      if (!pref['fieldVisibility']) pref['fieldVisibility'] = {}
      ;(pref['fieldVisibility'] as Record<string, unknown>)[typeKey] = views
      writePref(repoPath, username, pref)
    }
  )
}
