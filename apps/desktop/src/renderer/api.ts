import { createIpcClient } from '@polenta/api-client'
import { parseForgeAccessError } from '@polenta/types'
import { forgeAccessNotices } from './lib/forgeAccessNotices'

/**
 * GH45 — point unique d'interception des erreurs d'accès à une forge : une erreur portant le
 * marqueur `⟦forge-access …⟧` est signalée à la bannière globale, puis relancée avec son seul texte
 * lisible — toutes les UI existantes (Publier, indicateur de sync, clone…) affichent ainsi un
 * message propre sans modification.
 */
/**
 * Certains canaux renvoient l'échec dans le résultat (`{ status: 'parse-error', error }` à
 * l'ouverture d'un workspace, GH30) au lieu de rejeter : même traitement du champ `error`.
 */
function scrubResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const error = (value as { error?: unknown }).error
  if (typeof error !== 'string') return value
  const parsed = parseForgeAccessError(error)
  if (!parsed) return value
  forgeAccessNotices.report(parsed.issue)
  return { ...value, error: parsed.humanMessage }
}

async function transport(channel: string, ...args: unknown[]): Promise<unknown> {
  try {
    return scrubResult(await window.polenta.invoke(channel, ...args))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const parsed = parseForgeAccessError(message)
    if (!parsed) throw err
    forgeAccessNotices.report(parsed.issue)
    throw new Error(parsed.humanMessage)
  }
}

export const api = createIpcClient(transport)
