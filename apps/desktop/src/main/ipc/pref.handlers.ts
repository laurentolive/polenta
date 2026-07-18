import { ipcMain } from 'electron'
import { readPref, writePref } from '../services/pref-store.util'

export function registerPrefHandlers() {
  ipcMain.handle('pref:get-field-visibility',
    (_e, repoPath: string, username: string, typeKey: string) => {
      const pref = readPref(repoPath, username)
      const visibility = (pref['fieldVisibility'] as Record<string, unknown> | undefined) ?? {}
      return visibility[typeKey] ?? null
    }
  )

  ipcMain.handle('pref:set-field-visibility',
    (_e, repoPath: string, username: string, typeKey: string, views: { excel: string[]; word: string[]; edit: string[] }) => {
      const pref = readPref(repoPath, username)
      if (!pref['fieldVisibility']) pref['fieldVisibility'] = {}
      ;(pref['fieldVisibility'] as Record<string, unknown>)[typeKey] = views
      writePref(repoPath, username, pref)
    }
  )
}
