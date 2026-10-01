import type { Dashboard, QueryDefinition, QueryResult, SavedQuery } from '@polenta/types'
import type { McpContainer } from '../container'
import { errorToolResult } from '../mcp-types'
import { resolveWorkspaceRepoPaths } from '../../main/services/workspace-repos.util'
import { isReadonlyBranch } from '../../main/services/readonly-branch.util'
import { isReadOnlySql } from '../../main/services/query-engine.service'
import { isPrivateScopeId } from '../../main/services/id-scope.util'
import { formatCounterId, peekNextCounterId } from '../../main/services/id-counter.util'
import {
  unknownBuilderFields,
  validateQueryDefinitionShape,
  type SuiviErrorCode,
} from '../../main/services/suivi-validation.util'

/**
 * Helpers communs aux tools de la vue Suivi (GH18 — specs/GH18-design.md §3–4).
 */

/**
 * Sentinelle passée aux services quand `--user` est absent. Le caractère nul rend le
 * chemin `.{username}.pref` invalide : la lecture échoue → `{}` (aucun objet privé) et une
 * écriture lèverait — aucun `.pref` parasite ne peut être créé. Les tools refusent de toute
 * façon en amont toute opération privée sans utilisateur (`PRIVATE_SCOPE_UNAVAILABLE`).
 */
export const NO_USER = '\u0000no-user'

export function resolveUser(c: McpContainer): { username: string; hasUser: boolean } {
  return c.user ? { username: c.user, hasUser: true } : { username: NO_USER, hasUser: false }
}

/** Erreur de validation attendue : `[CODE] raison` (SPEC-MCP-SERVER §6). */
export function suiviError(code: SuiviErrorCode, reason: string): ReturnType<typeof errorToolResult> {
  return errorToolResult(`[${code}] ${reason}`)
}

export const PRIVATE_SCOPE_REASON =
  'Scope privé indisponible : serveur MCP lancé sans --user (ou POLENTA_USER).'

/** `READONLY_BRANCH` si la branche courante est en lecture seule, sinon null. */
export async function assertWritableBranch(c: McpContainer): Promise<ReturnType<typeof errorToolResult> | null> {
  const branch = await c.git.currentBranch(c.repoPath).catch(() => '')
  if (!isReadonlyBranch(branch)) return null
  return suiviError('READONLY_BRANCH', `Branche en lecture seule (${branch || 'HEAD détaché'}) : aucune écriture autorisée.`)
}

/**
 * Invalide les index exigences/tests de tous les repos du périmètre : ce process n'a pas
 * de RepoWatcherService, une requête exécutée sur l'index en cache ignorerait les objets
 * créés/modifiés par l'app depuis sa construction.
 */
export async function freshenIndexes(c: McpContainer): Promise<void> {
  const repoPaths = await resolveWorkspaceRepoPaths(c.workspaceTree, c.repoPath, c.workspaceDir)
  for (const p of repoPaths) {
    c.reqIndex.invalidate(p)
    c.testsIndex.invalidate(p)
  }
}

export type RunOutcome =
  | { ok: true; sql: string; result: QueryResult }
  | { ok: false; code: SuiviErrorCode; reason: string }

/**
 * Valide puis exécute une définition de requête, en classant l'échec (GH18-design §4) :
 * forme → FORBIDDEN_SQL → builder strict → exécution. Invalide les index avant d'exécuter.
 */
export async function runDefinition(c: McpContainer, def: QueryDefinition): Promise<RunOutcome> {
  const shape = validateQueryDefinitionShape(def)
  if (shape) return { ok: false, ...shape }

  let sql: string
  if (def.mode === 'sql') {
    sql = (def.sqlText ?? '').trim()
    if (!isReadOnlySql(sql)) {
      return {
        ok: false,
        code: 'FORBIDDEN_SQL',
        reason: 'Requête refusée : INSERT / UPDATE / DELETE / DROP / CREATE / ALTER / TRUNCATE / ATTACH / INTO interdits (lecture seule).',
      }
    }
  } else {
    const config = def.builderConfig!
    const target = await c.queryEngine.inspectBuilderTarget(c.repoPath, config.objectTypeRef, config.component, c.workspaceDir)
    if (!target.resolved) {
      return {
        ok: false,
        code: 'INVALID_BUILDER_CONFIG',
        reason: `Type d'objet introuvable : ${config.objectTypeRef}${config.component ? ` (composant ${config.component})` : ''}.`,
      }
    }
    const unknown = unknownBuilderFields(config, target.allowedFields)
    if (unknown.length > 0) {
      return {
        ok: false,
        code: 'INVALID_BUILDER_CONFIG',
        reason: `Champ(s) inconnu(s) pour ${config.objectTypeRef} : ${unknown.join(', ')}. Champs autorisés : ${target.allowedFields.join(', ')}.`,
      }
    }
    sql = await c.queryEngine.builderToSql(c.repoPath, config, c.workspaceDir)
  }

  await freshenIndexes(c)
  try {
    const result = await c.queryEngine.execute(c.repoPath, def, c.workspaceDir)
    return { ok: true, sql, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'QUERY_EXECUTION_ERROR', reason: message.replace(/^Requête invalide : /, '') }
  }
}

/** Colonnes du résultat, ou null si indéterminables (0 ligne : `inferColumns` ne voit rien). */
export function resultColumnNames(result: QueryResult): string[] | null {
  return result.rows.length === 0 ? null : result.columns.map((col) => col.name)
}

const SHARED_QUERY_ID = /^QUERY-\d+$/
const SHARED_DASHBOARD_ID = /^DASHBOARD-\d+$/

/** Requête visible par cet appel : un id privé sans `--user` n'est jamais résolu, et un id
 *  partagé hors format `QUERY-NNNN` non plus (il servirait de chemin de fichier). */
export async function findVisibleQuery(c: McpContainer, id: string): Promise<SavedQuery | null> {
  const { username, hasUser } = resolveUser(c)
  if (isPrivateScopeId(id) ? !hasUser : !SHARED_QUERY_ID.test(id)) return null
  return c.savedQueries.findOne(c.repoPath, username, id)
}

/** Dashboard visible par cet appel — mêmes règles que `findVisibleQuery` (`DASHBOARD-NNNN`). */
export async function findVisibleDashboard(c: McpContainer, id: string): Promise<Dashboard | null> {
  const { username, hasUser } = resolveUser(c)
  if (isPrivateScopeId(id) ? !hasUser : !SHARED_DASHBOARD_ID.test(id)) return null
  return c.dashboards.get(c.repoPath, username, id)
}

/** Id qu'aurait un objet partagé créé maintenant — même calcul que `nextCounterId`
 *  (fichiers + pierres tombales, GH20), en lecture seule. */
export async function peekSharedId(c: McpContainer, key: 'QUERY' | 'DASHBOARD'): Promise<string> {
  const dir = key === 'QUERY' ? 'queries' : 'dashboards'
  return formatCounterId(key, await peekNextCounterId(c.git, c.repoPath, key, dir))
}
