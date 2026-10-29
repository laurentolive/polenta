import type { HandlerRegistry } from './registry'
import { readPref, writePref } from '../services/pref-store.util'

/** Entrée `fieldVisibility[typeKey]` du `.pref` (cf. `FieldVisibilityPref` de l'api-client). */
type FieldVisibilityEntry = Record<string, unknown>

export function registerPrefHandlers(r: HandlerRegistry) {
  r.handle('pref:get-field-visibility',
    (_e, repoPath: string, username: string, typeKey: string) => {
      const pref = readPref(repoPath, username)
      const visibility = (pref['fieldVisibility'] as Record<string, FieldVisibilityEntry> | undefined) ?? {}
      // GH139 — choix personnel seul : sans entrée (ou pour une vue absente de l'entrée), le renderer
      // applique le défaut du schéma (`defaultVisible` des champs et types de lien).
      return visibility[typeKey] ?? null
    }
  )

  // GH176 — écriture partielle : les clés reçues remplacent celles de l'entrée, une clé à `null`
  // est supprimée, les autres sont conservées : la Vue Système et le sélecteur de tests (`picker`…)
  // écrivent chacun leurs clés sans effacer celles de l'autre.
  r.handle('pref:set-field-visibility',
    (_e, repoPath: string, username: string, typeKey: string, views: FieldVisibilityEntry) => {
      if (!views || typeof views !== 'object' || Array.isArray(views)) throw new Error('pref:set-field-visibility : objet attendu')
      const pref = readPref(repoPath, username)
      const visibility = (pref['fieldVisibility'] as Record<string, FieldVisibilityEntry> | undefined) ?? {}
      const next: FieldVisibilityEntry = { ...visibility[typeKey] }
      for (const [key, value] of Object.entries(views)) {
        if (value === null) delete next[key]
        else if (value !== undefined) next[key] = value
      }
      if (Object.keys(next).length > 0) visibility[typeKey] = next
      else delete visibility[typeKey]
      pref['fieldVisibility'] = visibility
      writePref(repoPath, username, pref)
    }
  )

  // GH133 — « Fusionner dans <intégration> » mémorisé par branche (`publishMerge[branch]`), dans le
  // `.pref` du repo publié. `null` : jamais publié depuis cette branche (la case reprend cochée).
  r.handle('pref:get-publish-merge',
    (_e, repoPath: string, username: string, branch: string) => {
      const choices = readPref(repoPath, username)['publishMerge'] as Record<string, unknown> | undefined
      const value = choices?.[branch]
      return typeof value === 'boolean' ? value : null
    }
  )

  r.handle('pref:set-publish-merge',
    (_e, repoPath: string, username: string, branch: string, merge: boolean) => {
      if (!branch || typeof merge !== 'boolean') throw new Error('pref:set-publish-merge : branche et booléen attendus')
      const pref = readPref(repoPath, username)
      pref['publishMerge'] = { ...(pref['publishMerge'] as Record<string, boolean> | undefined), [branch]: merge }
      writePref(repoPath, username, pref)
    }
  )
}
