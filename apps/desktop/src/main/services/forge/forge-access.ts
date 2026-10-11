import { encodeForgeAccessError, type ForgeAccessIssue } from '@polenta/types'

import { ForgeHttpError } from './forge-http'

/**
 * GH45 — erreurs d'accès à une forge (design §3.4, révisé §12).
 *
 * `ForgeAccessError` porte son diagnostic dans `message` (marqueur `⟦forge-access …⟧`) : c'est la
 * seule partie d'une erreur que l'IPC Electron et le bridge web transmettent au renderer, qui
 * retire le marqueur avant affichage (renderer/api.ts).
 */
export class ForgeAccessError extends Error {
  constructor(readonly issue: ForgeAccessIssue, readonly humanMessage: string) {
    super(encodeForgeAccessError(issue, humanMessage))
    this.name = 'ForgeAccessError'
  }
}

export function revokedError(host: string, serverUrl?: string): ForgeAccessError {
  return new ForgeAccessError(
    { status: 401, host, ...(serverUrl ? { serverUrl } : {}) },
    `Votre accès au serveur ${host} a été révoqué, a expiré ou votre compte a été désactivé. Reconnectez-vous.`,
  )
}

export function writeDeniedError(host: string, repo: string): ForgeAccessError {
  return new ForgeAccessError(
    { status: 403, host, repo },
    `Vous n'avez pas le droit de publier sur ${repo} (lecture seule ou branche protégée). Votre travail est conservé localement ; contactez votre administrateur.`,
  )
}

/**
 * Push refusé par la forge APRÈS authentification (droit d'écriture absent, branche protégée) :
 * Forgejo/Gitea répondent HTTP 200 puis refusent la mise à jour de la référence (« pre-receive hook
 * declined », mesuré le 2026-10-10 avec un membre de l'équipe lecteurs) — pas de 403.
 */
export function isPushDeclined(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; data?: { prettyDetails?: unknown }; stderr?: unknown } | null
  const text = [e?.message, e?.data?.prettyDetails, e?.stderr].filter(v => typeof v === 'string').join('\n')
  return /pre-receive hook declined|protected branch|not allowed to push/i.test(text)
}

/**
 * La forge a répondu à git par autre chose que le protocole git (typiquement HTTP 200 + page HTML :
 * compte désactivé, §12). Seul ce cas justifie une sonde de l'API — pas un rejet non fast-forward
 * ni une erreur locale, qui n'auraient pas à attendre un aller-retour réseau.
 */
export function isNonGitResponse(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; stderr?: unknown } | null
  if (e?.code === 'SmartHttpError') return true
  const text = [e?.message, e?.stderr].filter(v => typeof v === 'string').join('\n')
  return /smart" HTTP protocol|could not determine hash algorithm|is this a git repository|text\/html|<!DOCTYPE html/i.test(text)
}

/**
 * Statut HTTP d'une erreur git ou d'API, `null` si l'erreur n'en porte pas :
 * - isomorphic-git `HttpError` → `data.statusCode` (duck typing, robuste à une copie dupliquée) ;
 * - binaire git natif (remotes SSH ou locaux, T154) → « returned error: 401/403 », « Authentication failed » ;
 * - `ForgeHttpError` (API) → `status`.
 */
export function httpStatusOf(err: unknown): number | null {
  if (err instanceof ForgeAccessError) return err.issue.status
  if (err instanceof ForgeHttpError) return err.status
  const e = err as { code?: unknown; data?: { statusCode?: unknown }; message?: unknown; stderr?: unknown } | null
  if (e?.code === 'HttpError' && typeof e.data?.statusCode === 'number') return e.data.statusCode
  const text = `${typeof e?.message === 'string' ? e.message : ''}\n${typeof e?.stderr === 'string' ? e.stderr : ''}`
  const m = /returned error: (\d{3})/.exec(text)
  if (m) return Number(m[1])
  if (/Authentication failed/i.test(text)) return 401
  return null
}
