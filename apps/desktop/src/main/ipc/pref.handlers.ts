import type { HandlerRegistry } from './registry'
import { readPref, writePref } from '../services/pref-store.util'
import type { ForgeConfigService } from '../services/forge-config.service'

export function registerPrefHandlers(r: HandlerRegistry, forgeConfig?: ForgeConfigService) {
  r.handle('pref:get-field-visibility',
    (_e, repoPath: string, username: string, typeKey: string) => {
      const pref = readPref(repoPath, username)
      const visibility = (pref['fieldVisibility'] as Record<string, unknown> | undefined) ?? {}
      if (visibility[typeKey]) return visibility[typeKey]
      // GH45 S2b — sans choix personnel : défaut de l'équipe (jamais écrit dans le .pref ; une vue
      // non définie garde le défaut de Polenta).
      const teamDefault = forgeConfig?.status().config?.preferences.fieldVisibility?.[typeKey]
      return teamDefault ?? null
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
